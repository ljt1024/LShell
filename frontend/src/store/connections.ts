import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ServerConfig } from "../types/protocol";

export type ConnectionProfile = Omit<ServerConfig, "password" | "privateKey" | "privateKeyPassphrase">;

interface ConnectionStore {
  profiles: ConnectionProfile[];
  upsertProfile: (config: ServerConfig) => void;
  removeProfile: (id: string) => void;
}

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set) => ({
      profiles: [],
      upsertProfile: (config) => {
        const profile = stripSecrets(config);
        set((state) => {
          const exists = state.profiles.some((item) => item.id === profile.id);
          return {
            profiles: exists
              ? state.profiles.map((item) => (item.id === profile.id ? profile : item))
              : [profile, ...state.profiles]
          };
        });
      },
      removeProfile: (id) => {
        set((state) => ({
          profiles: state.profiles.filter((item) => item.id !== id)
        }));
      }
    }),
    {
      name: "lshell-connection-profiles",
      version: 1
    }
  )
);

function stripSecrets(config: ServerConfig): ConnectionProfile {
  return {
    id: config.id || crypto.randomUUID(),
    name: config.name,
    host: config.host,
    port: Number(config.port || 22),
    username: config.username,
    authType: config.authType,
    privateKeyPath: config.privateKeyPath,
    group: config.group
  };
}
