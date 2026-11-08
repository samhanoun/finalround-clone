/**
 * The few words the desktop app shows itself (tray menu, notifications,
 * dialogs, offline page), in the web app's five languages. The language
 * follows the page: the first path segment of the app's URL ("/es/…").
 * Tone as in src/messages: es tú, fr vous, de du, pt-BR você.
 */

export const LOCALES = ['en', 'es', 'fr', 'de', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

const en = {
  open: 'Open Apex Round',
  answerNow: 'Answer now',
  solveScreen: 'Solve screen',
  toggleAnswers: 'Show or hide answer window',
  screenToCapture: 'Screen to capture',
  displayName: 'Display {n}',
  displayMain: '{name} (main)',
  displayItem: '{name}, {width} × {height}',
  detectMeetings: 'Detect meetings',
  shortcuts: 'Shortcuts…',
  quit: 'Quit',
  meetingTitle: '{app} is using your microphone',
  meetingBody: 'Start a live session in Apex Round',
  trayNoticeTitle: 'Apex Round is still running',
  trayNoticeBody: 'Open it or quit from the icon in the tray',
  trayNoticeBodyMac: 'Open it or quit from the icon in the menu bar',
  leaveTitle: 'Leave the live page?',
  leaveBody: 'A session that is running ends when you leave the live page',
  leaveConfirm: 'Open settings',
  stay: 'Stay',
  offlineTitle: 'Can’t reach Apex Round',
  offlineBody: 'Nothing answered at {origin}. Check your connection. Apex Round tries again on its own.',
  offlineBodyDev: 'Nothing answered at {origin}. Start the web app (npm run dev) or set the app URL.',
  retry: 'Retry',
  updateTitle: '{appName} {version} is ready',
  updateBody: 'It installs when you quit {appName}',
} as const;

export type MessageKey = keyof typeof en;

export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];

const MESSAGES: Record<Locale, Record<MessageKey, string>> = {
  en,
  es: {
    open: 'Abrir Apex Round',
    answerNow: 'Responder ya',
    solveScreen: 'Resolver pantalla',
    toggleAnswers: 'Mostrar u ocultar la ventana de respuestas',
    screenToCapture: 'Pantalla que se captura',
    displayName: 'Pantalla {n}',
    displayMain: '{name} (principal)',
    displayItem: '{name}, {width} × {height}',
    detectMeetings: 'Detectar reuniones',
    shortcuts: 'Atajos…',
    quit: 'Salir',
    meetingTitle: '{app} está usando tu micrófono',
    meetingBody: 'Empieza una sesión en vivo en Apex Round',
    trayNoticeTitle: 'Apex Round sigue abierto',
    trayNoticeBody: 'Ábrelo o ciérralo desde el icono de la bandeja del sistema',
    trayNoticeBodyMac: 'Ábrelo o ciérralo desde el icono de la barra de menús',
    leaveTitle: '¿Salir de la página en vivo?',
    leaveBody: 'Si hay una sesión en curso, termina al salir de la página en vivo',
    leaveConfirm: 'Abrir ajustes',
    stay: 'Quedarme',
    offlineTitle: 'No se puede conectar con Apex Round',
    offlineBody: 'Nada respondió en {origin}. Revisa tu conexión. Apex Round vuelve a intentarlo solo.',
    offlineBodyDev: 'Nada respondió en {origin}. Inicia la app web (npm run dev) o configura la URL de la app.',
    retry: 'Reintentar',
    updateTitle: '{appName} {version} está listo',
    updateBody: 'Se instala cuando sales de {appName}',
  },
  fr: {
    open: 'Ouvrir Apex Round',
    answerNow: 'Répondre maintenant',
    solveScreen: 'Résoudre l’écran',
    toggleAnswers: 'Afficher ou masquer la fenêtre des réponses',
    screenToCapture: 'Écran à capturer',
    displayName: 'Écran {n}',
    displayMain: '{name} (principal)',
    displayItem: '{name}, {width} × {height}',
    detectMeetings: 'Détecter les réunions',
    shortcuts: 'Raccourcis…',
    quit: 'Quitter',
    meetingTitle: '{app} utilise votre micro',
    meetingBody: 'Lancez une session en direct dans Apex Round',
    trayNoticeTitle: 'Apex Round est toujours ouvert',
    trayNoticeBody: 'Ouvrez-le ou quittez-le depuis son icône dans la barre d’état',
    trayNoticeBodyMac: 'Ouvrez-le ou quittez-le depuis son icône dans la barre des menus',
    leaveTitle: 'Quitter la page en direct ?',
    leaveBody: 'Une session en cours se termine si vous quittez la page en direct',
    leaveConfirm: 'Ouvrir les paramètres',
    stay: 'Rester',
    offlineTitle: 'Impossible de joindre Apex Round',
    offlineBody: 'Rien n’a répondu à {origin}. Vérifiez votre connexion. Apex Round réessaie de lui-même.',
    offlineBodyDev: 'Rien n’a répondu à {origin}. Démarrez l’application web (npm run dev) ou définissez l’URL de l’application.',
    retry: 'Réessayer',
    updateTitle: '{appName} {version} est prêt',
    updateBody: 'La mise à jour s’installe quand vous quittez {appName}',
  },
  de: {
    open: 'Apex Round öffnen',
    answerNow: 'Jetzt antworten',
    solveScreen: 'Bildschirm lösen',
    toggleAnswers: 'Antwortfenster ein- oder ausblenden',
    screenToCapture: 'Aufgenommener Bildschirm',
    displayName: 'Bildschirm {n}',
    displayMain: '{name} (Hauptbildschirm)',
    displayItem: '{name}, {width} × {height}',
    detectMeetings: 'Meetings erkennen',
    shortcuts: 'Tastenkürzel…',
    quit: 'Beenden',
    meetingTitle: '{app} verwendet dein Mikrofon',
    meetingBody: 'Starte eine Live-Sitzung in Apex Round',
    trayNoticeTitle: 'Apex Round läuft weiter',
    trayNoticeBody: 'Öffne oder beende es über das Symbol im Infobereich',
    trayNoticeBodyMac: 'Öffne oder beende es über das Symbol in der Menüleiste',
    leaveTitle: 'Live-Seite verlassen?',
    leaveBody: 'Eine laufende Sitzung endet, wenn du die Live-Seite verlässt',
    leaveConfirm: 'Einstellungen öffnen',
    stay: 'Bleiben',
    offlineTitle: 'Apex Round ist nicht erreichbar',
    offlineBody: 'Unter {origin} hat nichts geantwortet. Prüfe deine Verbindung. Apex Round versucht es von selbst erneut.',
    offlineBodyDev: 'Unter {origin} hat nichts geantwortet. Starte die Web-App (npm run dev) oder lege die App-URL fest.',
    retry: 'Erneut versuchen',
    updateTitle: '{appName} {version} ist bereit',
    updateBody: 'Das Update wird installiert, wenn du {appName} beendest',
  },
  pt: {
    open: 'Abrir o Apex Round',
    answerNow: 'Responder agora',
    solveScreen: 'Resolver tela',
    toggleAnswers: 'Mostrar ou ocultar a janela de respostas',
    screenToCapture: 'Tela capturada',
    displayName: 'Tela {n}',
    displayMain: '{name} (principal)',
    displayItem: '{name}, {width} × {height}',
    detectMeetings: 'Detectar reuniões',
    shortcuts: 'Atalhos…',
    quit: 'Sair',
    meetingTitle: '{app} está usando seu microfone',
    meetingBody: 'Comece uma sessão ao vivo no Apex Round',
    trayNoticeTitle: 'O Apex Round continua aberto',
    trayNoticeBody: 'Abra ou feche pelo ícone na bandeja do sistema',
    trayNoticeBodyMac: 'Abra ou feche pelo ícone na barra de menus',
    leaveTitle: 'Sair da página ao vivo?',
    leaveBody: 'Uma sessão em andamento termina quando você sai da página ao vivo',
    leaveConfirm: 'Abrir configurações',
    stay: 'Ficar',
    offlineTitle: 'Não foi possível acessar o Apex Round',
    offlineBody: 'Nada respondeu em {origin}. Verifique sua conexão. O Apex Round tenta de novo sozinho.',
    offlineBodyDev: 'Nada respondeu em {origin}. Inicie o app web (npm run dev) ou defina a URL do app.',
    retry: 'Tentar de novo',
    updateTitle: '{appName} {version} está pronto',
    updateBody: 'A atualização é instalada quando você sai do {appName}',
  },
};

/** The message in `locale` (English if missing), with {name} placeholders filled. Unknown placeholders stay as written. */
export function translate(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  const template = MESSAGES[locale]?.[key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** "/es/copilot/live" → "es"; null when the first segment isn't one of the app's languages. */
export function localeFromPath(pathname: string): Locale | null {
  const first = /^\/([a-z]{2})(?=$|[/?#])/.exec(pathname)?.[1];
  return isLocale(first) ? first : null;
}

/** The language of an app URL ("https://app.example.com/fr/settings" → "fr"). */
export function localeFromUrl(url: string): Locale | null {
  try {
    return localeFromPath(new URL(url).pathname);
  } catch {
    return null;
  }
}

/** The first of the system's preferred languages ("pt-BR", "de-DE"…) the app speaks, else English. */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
