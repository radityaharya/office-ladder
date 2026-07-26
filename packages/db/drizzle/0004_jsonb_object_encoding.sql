-- Data-only migration: no schema changes.
--
-- Every jsonb column in this schema was written through drizzle's own `jsonb()`
-- column, whose `mapToDriverValue` is `JSON.stringify`. The `bun-sql` driver then
-- serialises that parameter *again*, because Postgres resolves the parameter's
-- type as jsonb and Bun JSON-encodes anything bound to a jsonb parameter. The two
-- encodings compose, so the stored value is a jsonb **string** holding the JSON
-- text of the real value: `jsonb_typeof(projection)` returns 'string',
-- `jsonb_object_keys(projection)` fails with 22023, and no index, `->` path or
-- operational query can see inside a room or a match. Round trips still worked,
-- which is why it went unnoticed — the double encoding reverses itself on read.
--
-- The write path is fixed in packages/db/src/json-column.ts (`jsonbValue`), which
-- reports the same `jsonb` data type, so this migration has nothing to alter and
-- only has to repair the rows already written.
--
-- Properties this is written to have:
--
--   * **Idempotent.** It only touches rows whose column is a jsonb string, so a
--     second run is a no-op and a mixed table (rows from before and after the
--     code fix) is fine.
--   * **Value-preserving.** It unwraps encodings and rewrites nothing else. A row
--     is only rewritten when the decoded value is an object or an array — the
--     shapes the bug actually produced. A column that legitimately holds a JSON
--     scalar is left exactly as it is, so this can never turn a stored `"5"` into
--     the number 5.
--   * **Never destructive.** A string that does not parse as JSON is left alone
--     and reported, not deleted; `decodeJsonbColumn` still reads such a row.
--     Nothing here can lose a match.
--   * **Quiet in the audit columns.** `updated_at` is deliberately not touched:
--     an encoding repair is not room activity and must not look like it.
--
-- The loop covers all seven jsonb columns, including the ones on the tables that
-- `PostgresRoomRepository` does not yet write (game_events, command_receipts,
-- player_projections, game_outbox). They are empty today, so those passes do
-- nothing — but they went through the same broken encoder, so any row that does
-- exist anywhere is repaired by the same run rather than by a second migration.
DO $$
DECLARE
	spec record;
	affected record;
	decoded jsonb;
	layer integer;
	rewritten integer;
	skipped integer;
BEGIN
	FOR spec IN
		SELECT * FROM (VALUES
			('room_projections', 'projection', 'room_id'),
			('games', 'canonical_state', 'id'),
			('rooms', 'custom_rules', 'id'),
			('game_events', 'canonical_payload', 'id'),
			('command_receipts', 'response_payload', 'id'),
			('player_projections', 'projection', 'id'),
			('game_outbox', 'payload', 'id')
		) AS t(table_name, column_name, key_column)
	LOOP
		rewritten := 0;
		skipped := 0;

		-- jsonb_typeof(NULL) is NULL, so a nullable column with no value never matches.
		FOR affected IN EXECUTE format(
			'SELECT %I AS row_key, %I AS encoded FROM %I WHERE jsonb_typeof(%I) = ''string''',
			spec.key_column, spec.column_name, spec.table_name, spec.column_name
		)
		LOOP
			decoded := affected.encoded;
			layer := 0;

			-- One layer per iteration, bounded: a row written by a build that
			-- stacked the encoding twice unwraps completely, and a pathological
			-- value cannot spin here. `#>> '{}'` is the jsonb string's own text.
			WHILE jsonb_typeof(decoded) = 'string' AND layer < 8 LOOP
				BEGIN
					decoded := (decoded #>> '{}')::jsonb;
				EXCEPTION WHEN others THEN
					-- Not JSON at all: a genuine string value. Leave it.
					EXIT;
				END;
				layer := layer + 1;
			END LOOP;

			IF jsonb_typeof(decoded) IN ('object', 'array') THEN
				EXECUTE format(
					'UPDATE %I SET %I = %L WHERE %I = %L',
					spec.table_name, spec.column_name, decoded, spec.key_column, affected.row_key
				);
				rewritten := rewritten + 1;
			ELSE
				skipped := skipped + 1;
			END IF;
		END LOOP;

		IF rewritten > 0 OR skipped > 0 THEN
			RAISE NOTICE '%.%: % row(s) re-encoded as jsonb, % left as stored strings',
				spec.table_name, spec.column_name, rewritten, skipped;
		END IF;
	END LOOP;
END $$;
