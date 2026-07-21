import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/rooms/$roomId")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session === null) {
      throw redirect({ to: "/sign-in" });
    }
  },
  component: Outlet,
});
