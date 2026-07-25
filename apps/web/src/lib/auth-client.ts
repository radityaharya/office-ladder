import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL:
    typeof window === "undefined"
      ? import.meta.env.VITE_BETTER_AUTH_URL
      : window.location.origin,
  plugins: [usernameClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
