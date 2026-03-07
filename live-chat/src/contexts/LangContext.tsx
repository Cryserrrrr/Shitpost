import React, { createContext, useContext, useState, useCallback } from "react";
import { Lang, TranslationKey, setLang as setLangGlobal, getLang, t as tGlobal } from "../i18n";

interface LangContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const LangContext = createContext<LangContextType | undefined>(undefined);

export const LangProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(getLang());

  const setLang = useCallback((newLang: Lang) => {
    setLangGlobal(newLang);
    setLangState(newLang);
  }, []);

  const t = useCallback(
    (key: TranslationKey) => tGlobal(key),
    [lang]
  );

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
};

export const useLang = () => {
  const context = useContext(LangContext);
  if (context === undefined) {
    throw new Error("useLang must be used within a LangProvider");
  }
  return context;
};
