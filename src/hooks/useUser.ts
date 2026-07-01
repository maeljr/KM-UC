import { useState, useEffect } from 'react';

interface UserInfo {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

interface AuthMeResponse {
  clientPrincipal: UserInfo | null;
}

export const useUser = () => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // En développement local, on simule une connexion après 500ms
    if (import.meta.env.DEV && import.meta.env.VITE_AUTH_MOCK !== 'false') {
      setTimeout(() => {
        setUser({
          identityProvider: 'aad',
          userId: 'dev-user-123',
          userDetails: 'consultant.haca@haca.com',
          userRoles: ['authenticated', 'contributeur']
        });
        setLoading(false);
      }, 500);
      return;
    }

    // En production Azure : appel réel à /.auth/me
    fetch('/.auth/me')
      .then((response) => response.json())
      .then((data: AuthMeResponse) => {
        setUser(data.clientPrincipal ?? null);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Erreur d'authentification :", err);
        setError("Service d'authentification indisponible.");
        setUser(null);
        setLoading(false);
      });
  }, []);

  return { user, loading, error };
};