import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsWindow } from './settings/SettingsWindow';
import { ConfigProvider } from './contexts/ConfigContext';
import { LocaleProvider } from './i18n';
import './App.css';

ReactDOM.createRoot(
  document.getElementById('settings-root') as HTMLElement,
).render(
  <React.StrictMode>
    <LocaleProvider>
      <ConfigProvider>
        <SettingsWindow />
      </ConfigProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
