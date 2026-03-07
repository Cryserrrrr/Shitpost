const getOrCreateMachineId = (): string => {
  const storedId = localStorage.getItem("tauri-machine-id");
  if (storedId) {
    return storedId;
  }

  const newId = `tauri-app-${Math.random().toString(36).substr(2, 9)}`;
  localStorage.setItem("tauri-machine-id", newId);
  return newId;
};

const getOrCreatePseudo = (): string => {
  const storedPseudo = localStorage.getItem("tauri-pseudo");
  if (storedPseudo) {
    return storedPseudo;
  }

  const defaultPseudo = `User-${Math.random().toString(36).substr(2, 6)}`;
  localStorage.setItem("tauri-pseudo", defaultPseudo);
  return defaultPseudo;
};

export const SHARED_CONFIG = {
  machineId: getOrCreateMachineId(),
  get serverUrl() { return localStorage.getItem("serverUrl") || "http://127.0.0.1:3000"; },
  isDev: import.meta.env.VITE_DEV_MODE === "true",
  pseudo: getOrCreatePseudo(),
};

export const updatePseudo = (newPseudo: string): void => {
  localStorage.setItem("tauri-pseudo", newPseudo);
  window.location.reload();
};
