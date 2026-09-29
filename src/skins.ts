export type SkinType = 'modern' | 'win95' | 'winamp' | 'crt';

export interface SkinDefinition {
  name: string;
  label: string;
  root: string;
  header: string;
  headerBorder: string;
  body: string;
  buttonPrimary: string;
  buttonSecondary: string;
  buttonDanger: string;
  buttonGhost: string;
  select: string;
  selectOption: string;
  pickerButton: string;
  pickerPanel: string;
  pickerTitle: string;
  pickerClose: string;
  pickerCard: string;
  pickerCardActive: string;
  pickerCardLabel: string;
  pickerBadge: string;
  pickerBadgeActive: string;
  settingsPanel: string;
  settingsLabel: string;
  settingsValue: string;
  settingsSlider: string;
  settingsDescription: string;
  settingsButton: string;
  dialog: string;
  dialogOverlay: string;
  dialogInput: string;
  dialogButtonPrimary: string;
  dialogButtonSecondary: string;
  errorBanner: string;
  mobileHint: string;
  title: string;
  subtitle: string;
  heroIcon: string;
  heroTitle: string;
  heroText: string;
  versionLabel: string;
  atmosphericBg: boolean;
  sendspinBar: string;
  sendspinTrackTitle: string;
  sendspinTrackArtist: string;
  sendspinButton: string;
  sendspinButtonActive: string;
  /** A switched-on bar button (shuffle, repeat, queue, favorite): the whole button, not an add-on class. */
  sendspinButtonOn: string;
  sendspinPlayButton: string;
  sendspinDivider: string;
  sendspinVolumeSlider: string;
  sendspinBarRow: string;
  /** The tab on top of the bar that slides it down and back up. Its height is set by the bar. */
  sendspinHandle: string;
  sendspinTrackAlbum: string;
  sendspinStatus: string;
  sendspinProgressTime: string;
  sendspinProgressTrack: string;
  sendspinProgressFill: string;
  sendspinSeekSlider: string;
  sendspinPanel: string;
  sendspinPanelTitle: string;
  sendspinTab: string;
  sendspinTabActive: string;
  sendspinListItem: string;
  sendspinListItemActive: string;
  sendspinListMeta: string;
}

export const skins: Record<SkinType, SkinDefinition> = {
  modern: {
    name: 'modern',
    label: 'Modern',
    root: 'min-h-dvh bg-black text-white flex flex-col font-sans relative overflow-hidden',
    header: 'px-4 py-3 md:p-6 flex flex-wrap sm:flex-nowrap items-center gap-x-3 md:gap-x-4 gap-y-3 bg-black/20 backdrop-blur-md border-b border-white/10 transition-all duration-300',
    headerBorder: '',
    body: 'flex-1 flex flex-col items-center justify-center relative overflow-hidden',
    buttonPrimary: 'flex items-center gap-2 px-4 py-2 rounded-full bg-purple-600/80 hover:bg-purple-500 transition-colors border border-purple-400/30 text-sm shadow-[0_0_15px_rgba(147,51,234,0.3)] cursor-pointer',
    buttonSecondary: 'flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors border border-white/5 text-sm cursor-pointer',
    buttonDanger: 'flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-colors border border-red-500/30 text-sm cursor-pointer',
    buttonGhost: 'flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/5 text-white/70 hover:text-white text-sm cursor-pointer',
    select: 'appearance-none bg-white/10 hover:bg-white/20 border border-white/10 rounded-full pl-4 pr-10 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer transition-colors',
    selectOption: 'bg-gray-900',
    pickerButton: 'flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-full px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500 cursor-pointer transition-colors',
    pickerPanel: 'bg-gray-900 border border-white/10 rounded-2xl p-4 sm:p-6 w-full max-w-5xl max-h-[85dvh] mx-3 sm:mx-4 flex flex-col',
    pickerTitle: 'text-xl font-light',
    pickerClose: 'text-white/50 hover:text-white transition-colors cursor-pointer',
    pickerCard: 'group rounded-xl border border-white/10 hover:border-purple-400/60 bg-white/5 text-left cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500',
    pickerCardActive: 'border-purple-500 ring-2 ring-purple-500',
    pickerCardLabel: 'block px-3 py-2 text-sm text-white/80',
    pickerBadge: 'flex items-center gap-0.5 px-1.5 py-1 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 text-white/50 hover:text-white hover:border-white/40 cursor-pointer transition-colors pointer-coarse:p-2',
    pickerBadgeActive: 'flex items-center gap-0.5 px-1.5 py-1 rounded-full bg-purple-600/90 border border-purple-400/60 text-white cursor-pointer shadow-[0_0_8px_rgba(147,51,234,0.5)] transition-colors pointer-coarse:p-2',
    settingsPanel: 'absolute top-0 right-0 bottom-0 w-full sm:w-80 overflow-y-auto overscroll-contain bg-black/80 backdrop-blur-xl border-l border-white/10 p-5 sm:p-6 transform transition-transform duration-300 z-50',
    settingsLabel: 'text-sm text-white/70',
    settingsValue: 'text-sm text-purple-400',
    settingsSlider: 'w-full accent-purple-500',
    settingsDescription: 'text-xs text-white/40 mt-2',
    settingsButton: 'w-full py-2 mt-4 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm transition-colors cursor-pointer',
    dialog: 'bg-gray-900 border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4 mx-4',
    dialogOverlay: 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center',
    dialogInput: 'w-full bg-white/10 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500',
    dialogButtonPrimary: 'px-4 py-2 rounded-lg bg-purple-600/80 hover:bg-purple-500 border border-purple-400/30 text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
    dialogButtonSecondary: 'px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm transition-colors cursor-pointer',
    errorBanner: 'fixed w-max max-w-[calc(100vw-2rem)] top-6 left-1/2 -translate-x-1/2 bg-red-500/20 border border-red-500/50 text-red-200 px-6 py-3 rounded-xl backdrop-blur-md z-[110] flex items-center gap-3',
    mobileHint: 'md:hidden flex items-center justify-center gap-2 bg-white/5 border-b border-white/10 px-4 py-2 text-xs text-red-400 tracking-wide',
    title: 'text-base sm:text-lg md:text-2xl font-light tracking-[0.15em] sm:tracking-[0.2em] md:tracking-widest uppercase truncate',
    subtitle: 'mt-1 text-xs tracking-[0.2em] text-white/60',
    heroIcon: 'w-24 h-24 mx-auto border border-white/10 rounded-full flex items-center justify-center bg-white/5 backdrop-blur-sm',
    heroTitle: 'text-3xl font-light',
    heroText: 'text-white/50 font-light leading-relaxed',
    versionLabel: 'absolute bottom-3 left-4 text-[10px] tracking-[0.18em] uppercase text-white/25 pointer-events-none select-none z-40',
    atmosphericBg: true,
    sendspinBar: 'pointer-events-auto bg-black/70 backdrop-blur-xl border border-white/10 rounded-t-2xl px-6 py-3 max-w-full flex flex-col gap-2',
    sendspinTrackTitle: 'text-sm text-white truncate max-w-[70vw] sm:max-w-[200px]',
    sendspinTrackArtist: 'text-xs text-white/50 truncate max-w-[70vw] sm:max-w-[200px]',
    sendspinButton: 'p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed',
    sendspinButtonActive: 'text-purple-400',
    sendspinButtonOn: 'p-2 rounded-full bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed',
    sendspinPlayButton: 'p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed',
    sendspinDivider: 'max-sm:hidden w-px h-6 bg-white/10',
    sendspinVolumeSlider: 'w-20 accent-purple-500 disabled:opacity-30',
    sendspinBarRow: 'flex flex-wrap sm:flex-nowrap justify-center items-center gap-x-4 gap-y-2',
    sendspinHandle: 'pointer-events-auto flex items-center px-3 -mb-px bg-black/70 backdrop-blur-xl border border-b-0 border-white/10 rounded-t-lg text-[11px] text-white/60 hover:text-white transition-colors cursor-pointer',
    sendspinTrackAlbum: 'text-xs text-white/35 truncate max-w-[70vw] sm:max-w-[200px] max-sm:hidden',
    sendspinStatus: 'text-[10px] uppercase tracking-[0.15em] text-purple-300/80 whitespace-nowrap',
    sendspinProgressTime: 'text-[10px] tabular-nums text-white/40 w-12 text-center flex-shrink-0',
    sendspinProgressTrack: 'relative flex-1 h-1 rounded-full bg-white/10 overflow-hidden',
    sendspinProgressFill: 'absolute inset-y-0 left-0 rounded-full bg-purple-500/80',
    sendspinSeekSlider: 'flex-1 min-w-0 h-1 accent-purple-500 cursor-pointer',
    sendspinPanel: 'pointer-events-auto mb-2 w-[calc(100vw-1rem)] sm:w-[28rem] max-h-[min(60dvh,28rem)] flex flex-col gap-2 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl',
    sendspinPanelTitle: 'text-sm text-white/80 font-light tracking-wide',
    sendspinTab: 'px-3 py-1 rounded-full text-xs bg-white/5 hover:bg-white/10 border border-white/5 text-white/60 hover:text-white cursor-pointer transition-colors',
    sendspinTabActive: 'px-3 py-1 rounded-full text-xs bg-purple-600/80 border border-purple-400/40 text-white cursor-pointer transition-colors',
    sendspinListItem: 'w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left text-sm text-white/80 hover:bg-white/10 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait',
    sendspinListItemActive: 'bg-purple-500/15 text-white',
    sendspinListMeta: 'text-xs text-white/40 truncate',
  },
  win95: {
    name: 'win95',
    label: 'Windows 95',
    root: 'min-h-dvh bg-[#008080] text-black flex flex-col font-["MS_Sans_Serif",_"Microsoft_Sans_Serif",_Tahoma,_sans-serif] relative overflow-hidden skin-90s',
    header: 'p-2 flex flex-wrap sm:flex-nowrap items-center gap-x-3 md:gap-x-4 gap-y-2 bg-[#c0c0c0] border-b-2 border-r-2 border-[#808080] border-t-2 border-l-2 border-t-white border-l-white transition-all duration-300',
    headerBorder: '',
    body: 'flex-1 flex flex-col items-center justify-center relative overflow-hidden',
    buttonPrimary: 'flex items-center gap-2 px-4 py-1.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-sm text-black font-bold cursor-pointer active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    buttonSecondary: 'flex items-center gap-2 px-4 py-1.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-sm text-black cursor-pointer active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    buttonDanger: 'flex items-center gap-2 px-4 py-1.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-sm text-red-700 font-bold cursor-pointer active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    buttonGhost: 'flex items-center gap-2 px-4 py-1.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-sm text-black cursor-pointer active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    select: 'appearance-none bg-white border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white pl-2 pr-8 py-1 text-sm text-black focus:outline-none cursor-pointer',
    selectOption: 'bg-white text-black',
    pickerButton: 'flex items-center gap-2 bg-white border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white px-2 py-1 text-sm text-black cursor-pointer',
    pickerPanel: 'bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] p-3 w-full max-w-5xl max-h-[85dvh] mx-3 sm:mx-4 flex flex-col',
    pickerTitle: 'text-lg font-bold text-[#000080]',
    pickerClose: 'cursor-pointer text-black',
    pickerCard: 'bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-left cursor-pointer active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    pickerCardActive: 'outline outline-2 outline-[#000080]',
    pickerCardLabel: 'block px-2 py-1 text-sm text-black',
    pickerBadge: 'flex items-center gap-0.5 px-1 py-0.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-[#808080] cursor-pointer active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white pointer-coarse:p-2',
    pickerBadgeActive: 'flex items-center gap-0.5 px-1 py-0.5 bg-[#c0c0c0] border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white text-[#000080] cursor-pointer pointer-coarse:p-2',
    settingsPanel: 'absolute top-0 right-0 bottom-0 w-full sm:w-80 overflow-y-auto overscroll-contain bg-[#c0c0c0] border-l-2 border-l-white border-t-2 border-t-white p-4 transform transition-transform duration-300 z-50',
    settingsLabel: 'text-sm text-black font-bold',
    settingsValue: 'text-sm text-[#000080]',
    settingsSlider: 'w-full accent-[#000080]',
    settingsDescription: 'text-xs text-[#808080] mt-1',
    settingsButton: 'w-full py-1.5 mt-4 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-sm font-bold cursor-pointer active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    dialog: 'bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] p-1 w-full max-w-md space-y-3 mx-4',
    dialogOverlay: 'fixed inset-0 bg-[#008080]/80 z-[100] flex items-center justify-center',
    dialogInput: 'w-full bg-white border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white px-2 py-1 text-black placeholder-[#808080] focus:outline-none',
    dialogButtonPrimary: 'px-4 py-1.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-sm font-bold cursor-pointer disabled:text-[#808080] active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    dialogButtonSecondary: 'px-4 py-1.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-sm cursor-pointer active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    errorBanner: 'fixed w-max max-w-[calc(100vw-2rem)] top-6 left-1/2 -translate-x-1/2 bg-white border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-red-700 px-4 py-2 z-[110] flex items-center gap-3',
    mobileHint: 'md:hidden flex items-center justify-center gap-2 bg-[#ffff00] border-b-2 border-b-[#808080] px-4 py-1 text-xs text-black font-bold',
    title: 'text-lg font-bold uppercase text-[#000080] truncate',
    subtitle: 'text-xs text-[#808080]',
    heroIcon: 'w-24 h-24 mx-auto border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white flex items-center justify-center bg-white',
    heroTitle: 'text-2xl font-bold text-[#000080]',
    heroText: 'text-black leading-relaxed',
    versionLabel: 'absolute bottom-3 left-4 text-[10px] text-[#808080] pointer-events-none select-none z-40',
    atmosphericBg: false,
    sendspinBar: 'pointer-events-auto bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] px-4 py-2 max-w-full flex flex-col gap-1.5',
    sendspinTrackTitle: 'text-sm text-black truncate max-w-[70vw] sm:max-w-[200px] font-bold',
    sendspinTrackArtist: 'text-xs text-[#808080] truncate max-w-[70vw] sm:max-w-[200px]',
    sendspinButton: 'p-1.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-black cursor-pointer disabled:text-[#808080] active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    sendspinButtonActive: 'text-[#000080]',
    sendspinButtonOn: 'p-1.5 bg-[#dcdcdc] border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white text-[#000080] cursor-pointer disabled:text-[#808080]',
    sendspinPlayButton: 'p-1.5 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-black cursor-pointer disabled:text-[#808080] active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    sendspinDivider: 'max-sm:hidden w-px h-6 bg-[#808080]',
    sendspinVolumeSlider: 'w-20 accent-[#000080] disabled:opacity-50',
    sendspinBarRow: 'flex flex-wrap sm:flex-nowrap justify-center items-center gap-x-3 gap-y-2',
    sendspinHandle: 'pointer-events-auto flex items-center px-2 -mb-0.5 bg-[#c0c0c0] border-2 border-b-0 border-t-white border-l-white border-r-[#808080] text-[11px] text-black cursor-pointer',
    sendspinTrackAlbum: 'text-xs text-[#808080] italic truncate max-w-[70vw] sm:max-w-[200px] max-sm:hidden',
    sendspinStatus: 'text-[11px] font-bold text-[#000080] whitespace-nowrap',
    sendspinProgressTime: 'text-[11px] tabular-nums text-black w-12 text-center flex-shrink-0',
    sendspinProgressTrack: 'relative flex-1 h-3 bg-white border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white overflow-hidden',
    sendspinProgressFill: 'absolute inset-y-0 left-0 bg-[#000080]',
    sendspinSeekSlider: 'flex-1 min-w-0 accent-[#000080] cursor-pointer',
    sendspinPanel: 'pointer-events-auto mb-1 w-[calc(100vw-1rem)] sm:w-[28rem] max-h-[min(60dvh,28rem)] flex flex-col gap-2 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] p-2 text-black',
    sendspinPanelTitle: 'text-sm font-bold text-black',
    sendspinTab: 'px-3 py-0.5 text-xs bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] text-black cursor-pointer active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white',
    sendspinTabActive: 'px-3 py-0.5 text-xs font-bold bg-[#dcdcdc] border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white text-black cursor-pointer',
    sendspinListItem: 'w-full flex items-center gap-2 px-1.5 py-1 text-left text-sm text-black hover:bg-[#d4d4d4] cursor-pointer disabled:text-[#808080] disabled:cursor-wait',
    sendspinListItemActive: 'bg-[#d4d4d4] font-bold outline outline-1 outline-dotted outline-black',
    sendspinListMeta: 'text-xs text-[#808080] font-normal truncate',
  },
  winamp: {
    name: 'winamp',
    label: 'Winamp',
    root: 'min-h-dvh bg-[#3a3a4a] text-[#00ff00] flex flex-col font-["Arial_Narrow",_Arial,_sans-serif] relative overflow-hidden skin-winamp',
    header: 'p-3 md:p-4 flex flex-wrap sm:flex-nowrap items-center gap-x-3 md:gap-x-4 gap-y-3 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] transition-all duration-300',
    headerBorder: '',
    body: 'flex-1 flex flex-col items-center justify-center relative overflow-hidden',
    buttonPrimary: 'flex items-center gap-2 px-4 py-2 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-sm text-[#d0d0d0] font-bold uppercase cursor-pointer active:border-t-[#1a1a2a] active:border-l-[#1a1a2a] active:border-b-[#6a6a7a] active:border-r-[#6a6a7a]',
    buttonSecondary: 'flex items-center gap-2 px-4 py-2 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-sm text-[#d0d0d0] uppercase cursor-pointer active:border-t-[#1a1a2a] active:border-l-[#1a1a2a] active:border-b-[#6a6a7a] active:border-r-[#6a6a7a]',
    buttonDanger: 'flex items-center gap-2 px-4 py-2 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-sm text-[#ff6666] font-bold uppercase cursor-pointer active:border-t-[#1a1a2a] active:border-l-[#1a1a2a] active:border-b-[#6a6a7a] active:border-r-[#6a6a7a]',
    buttonGhost: 'flex items-center gap-2 px-4 py-2 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-sm text-[#a0a0a0] uppercase cursor-pointer active:border-t-[#1a1a2a] active:border-l-[#1a1a2a] active:border-b-[#6a6a7a] active:border-r-[#6a6a7a]',
    select: 'appearance-none bg-[#0a0a14] border-2 border-t-[#1a1a2a] border-l-[#1a1a2a] border-b-[#6a6a7a] border-r-[#6a6a7a] pl-4 pr-10 py-2 text-sm text-[#00ff00] focus:outline-none cursor-pointer',
    selectOption: 'bg-[#0a0a14] text-[#00ff00]',
    pickerButton: 'flex items-center gap-2 bg-[#0a0a14] border-2 border-t-[#1a1a2a] border-l-[#1a1a2a] border-b-[#6a6a7a] border-r-[#6a6a7a] px-4 py-2 text-sm text-[#00ff00] cursor-pointer',
    pickerPanel: 'bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] p-4 sm:p-5 w-full max-w-5xl max-h-[85dvh] mx-3 sm:mx-4 flex flex-col',
    pickerTitle: 'text-lg font-bold text-[#00ff00] uppercase tracking-wider',
    pickerClose: 'cursor-pointer text-[#a0a0a0] hover:text-[#d0d0d0]',
    pickerCard: 'bg-[#0a0a14] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-left cursor-pointer',
    pickerCardActive: 'outline outline-2 outline-[#00ff00]',
    pickerCardLabel: 'block px-2 py-1.5 text-xs text-[#00ff00] uppercase tracking-wider',
    pickerBadge: 'flex items-center gap-0.5 px-1 py-0.5 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-[#808090] hover:text-[#d0d0d0] cursor-pointer pointer-coarse:p-2',
    pickerBadgeActive: 'flex items-center gap-0.5 px-1 py-0.5 bg-[#0a0a14] border-2 border-t-[#1a1a2a] border-l-[#1a1a2a] border-b-[#6a6a7a] border-r-[#6a6a7a] text-[#00ff00] cursor-pointer pointer-coarse:p-2',
    settingsPanel: 'absolute top-0 right-0 bottom-0 w-full sm:w-80 overflow-y-auto overscroll-contain bg-[#3a3a4a] border-l-2 border-l-[#6a6a7a] p-5 sm:p-6 transform transition-transform duration-300 z-50',
    settingsLabel: 'text-sm text-[#d0d0d0] uppercase tracking-wider',
    settingsValue: 'text-sm text-[#00ff00] font-bold',
    settingsSlider: 'w-full accent-[#00ff00]',
    settingsDescription: 'text-xs text-[#808090] mt-2',
    settingsButton: 'w-full py-2 mt-4 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-sm text-[#d0d0d0] uppercase cursor-pointer active:border-t-[#1a1a2a] active:border-l-[#1a1a2a] active:border-b-[#6a6a7a] active:border-r-[#6a6a7a]',
    dialog: 'bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] p-5 w-full max-w-md space-y-4 mx-4',
    dialogOverlay: 'fixed inset-0 bg-[#1a1a2a]/90 z-[100] flex items-center justify-center',
    dialogInput: 'w-full bg-[#0a0a14] border-2 border-t-[#1a1a2a] border-l-[#1a1a2a] border-b-[#6a6a7a] border-r-[#6a6a7a] px-4 py-2 text-[#00ff00] text-sm placeholder-[#00ff00]/30 focus:outline-none',
    dialogButtonPrimary: 'px-4 py-2 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-sm text-[#d0d0d0] font-bold uppercase cursor-pointer disabled:text-[#606070] active:border-t-[#1a1a2a] active:border-l-[#1a1a2a] active:border-b-[#6a6a7a] active:border-r-[#6a6a7a]',
    dialogButtonSecondary: 'px-4 py-2 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-sm text-[#a0a0a0] uppercase cursor-pointer active:border-t-[#1a1a2a] active:border-l-[#1a1a2a] active:border-b-[#6a6a7a] active:border-r-[#6a6a7a]',
    errorBanner: 'fixed w-max max-w-[calc(100vw-2rem)] top-6 left-1/2 -translate-x-1/2 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-[#ff6666] px-6 py-3 z-[110] flex items-center gap-3 text-sm',
    mobileHint: 'md:hidden flex items-center justify-center gap-2 bg-[#3a3a4a] border-b-2 border-b-[#1a1a2a] px-4 py-2 text-xs text-[#ff6666]',
    title: 'text-base sm:text-lg md:text-xl font-bold uppercase tracking-[0.1em] sm:tracking-[0.2em] text-[#d0d0d0] truncate',
    subtitle: 'mt-1 text-xs tracking-wider text-[#808090]',
    heroIcon: 'w-24 h-24 mx-auto border-2 border-t-[#1a1a2a] border-l-[#1a1a2a] border-b-[#6a6a7a] border-r-[#6a6a7a] flex items-center justify-center bg-[#0a0a14]',
    heroTitle: 'text-3xl font-bold text-[#00ff00] tracking-wide',
    heroText: 'text-[#00ff00]/60 text-sm leading-relaxed',
    versionLabel: 'absolute bottom-3 left-4 text-[10px] tracking-wider text-[#606070] pointer-events-none select-none z-40',
    atmosphericBg: false,
    sendspinBar: 'pointer-events-auto bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] px-6 py-3 max-w-full flex flex-col gap-2',
    sendspinTrackTitle: 'text-sm text-[#00ff00] truncate max-w-[70vw] sm:max-w-[200px] font-bold',
    sendspinTrackArtist: 'text-xs text-[#00ff00]/50 truncate max-w-[70vw] sm:max-w-[200px]',
    sendspinButton: 'p-2 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-[#a0a0a0] hover:text-[#d0d0d0] cursor-pointer disabled:text-[#606070] disabled:cursor-not-allowed active:border-t-[#1a1a2a] active:border-l-[#1a1a2a] active:border-b-[#6a6a7a] active:border-r-[#6a6a7a]',
    sendspinButtonActive: 'text-[#00ff00]',
    sendspinButtonOn: 'p-2 bg-[#2a2a3a] border-2 border-t-[#1a1a2a] border-l-[#1a1a2a] border-b-[#6a6a7a] border-r-[#6a6a7a] text-[#00ff00] cursor-pointer disabled:text-[#606070] disabled:cursor-not-allowed',
    sendspinPlayButton: 'p-2 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-[#d0d0d0] cursor-pointer disabled:text-[#606070] disabled:cursor-not-allowed active:border-t-[#1a1a2a] active:border-l-[#1a1a2a] active:border-b-[#6a6a7a] active:border-r-[#6a6a7a]',
    sendspinDivider: 'max-sm:hidden w-px h-6 bg-[#1a1a2a]',
    sendspinVolumeSlider: 'w-20 accent-[#00ff00] disabled:opacity-30',
    sendspinBarRow: 'flex flex-wrap sm:flex-nowrap justify-center items-center gap-x-4 gap-y-2',
    sendspinHandle: 'pointer-events-auto flex items-center px-2 -mb-0.5 bg-[#3a3a4a] border-2 border-b-0 border-t-[#6a6a7a] border-l-[#6a6a7a] border-r-[#1a1a2a] text-[10px] uppercase tracking-wider text-[#a0a0a0] hover:text-[#00ff00] cursor-pointer',
    sendspinTrackAlbum: 'text-xs text-[#00ff00]/35 truncate max-w-[70vw] sm:max-w-[200px] max-sm:hidden',
    sendspinStatus: 'text-[10px] uppercase tracking-widest text-[#ffcc00] whitespace-nowrap',
    sendspinProgressTime: 'text-[11px] tabular-nums font-mono text-[#00ff00] w-12 text-center flex-shrink-0',
    sendspinProgressTrack: 'relative flex-1 h-2 bg-[#0a0a14] border border-t-[#1a1a2a] border-l-[#1a1a2a] border-b-[#6a6a7a] border-r-[#6a6a7a] overflow-hidden',
    sendspinProgressFill: 'absolute inset-y-0 left-0 bg-[#00ff00]/70',
    sendspinSeekSlider: 'flex-1 min-w-0 accent-[#00ff00] cursor-pointer',
    sendspinPanel: 'pointer-events-auto mb-1 w-[calc(100vw-1rem)] sm:w-[28rem] max-h-[min(60dvh,28rem)] flex flex-col gap-2 bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] p-3',
    sendspinPanelTitle: 'text-sm font-bold text-[#00ff00] uppercase tracking-wider',
    sendspinTab: 'px-3 py-1 text-xs bg-[#3a3a4a] border-2 border-t-[#6a6a7a] border-l-[#6a6a7a] border-b-[#1a1a2a] border-r-[#1a1a2a] text-[#a0a0a0] uppercase cursor-pointer active:border-t-[#1a1a2a] active:border-l-[#1a1a2a] active:border-b-[#6a6a7a] active:border-r-[#6a6a7a]',
    sendspinTabActive: 'px-3 py-1 text-xs bg-[#0a0a14] border-2 border-t-[#1a1a2a] border-l-[#1a1a2a] border-b-[#6a6a7a] border-r-[#6a6a7a] text-[#00ff00] uppercase cursor-pointer',
    sendspinListItem: 'w-full flex items-center gap-2 px-2 py-1 text-left text-sm font-mono text-[#00ff00]/80 hover:bg-[#0a0a14] cursor-pointer disabled:opacity-50 disabled:cursor-wait',
    sendspinListItemActive: 'bg-[#0a0a14] text-[#00ff00]',
    sendspinListMeta: 'text-xs text-[#00ff00]/40 truncate',
  },
  crt: {
    name: 'crt',
    label: 'CRT Monitor',
    root: 'min-h-dvh bg-[#0a0a0a] text-[#00ff00] flex flex-col font-["Courier_New",_Courier,_monospace] relative overflow-hidden skin-crt',
    header: 'p-3 md:p-4 flex flex-wrap sm:flex-nowrap items-center gap-x-3 md:gap-x-4 gap-y-3 bg-[#0a0a0a] border-b border-[#00ff00]/20 transition-all duration-300',
    headerBorder: '',
    body: 'flex-1 flex flex-col items-center justify-center relative overflow-hidden',
    buttonPrimary: 'flex items-center gap-2 px-3 py-1.5 bg-transparent border border-[#00ff00] text-sm text-[#00ff00] font-bold cursor-pointer hover:bg-[#00ff00]/10 hover:shadow-[0_0_8px_rgba(0,255,0,0.3)]',
    buttonSecondary: 'flex items-center gap-2 px-3 py-1.5 bg-transparent border border-[#00ff00]/50 text-sm text-[#00ff00]/80 cursor-pointer hover:border-[#00ff00] hover:text-[#00ff00] hover:shadow-[0_0_8px_rgba(0,255,0,0.2)]',
    buttonDanger: 'flex items-center gap-2 px-3 py-1.5 bg-transparent border border-[#ff3333]/70 text-sm text-[#ff3333] cursor-pointer hover:bg-[#ff3333]/10 hover:shadow-[0_0_8px_rgba(255,51,51,0.3)]',
    buttonGhost: 'flex items-center gap-2 px-3 py-1.5 bg-transparent border border-[#00ff00]/30 text-sm text-[#00ff00]/60 cursor-pointer hover:border-[#00ff00]/60 hover:text-[#00ff00]',
    select: 'appearance-none bg-[#0a0a0a] border border-[#00ff00]/50 pl-2 pr-8 py-1 text-sm text-[#00ff00] focus:outline-none focus:border-[#00ff00] focus:shadow-[0_0_6px_rgba(0,255,0,0.3)] cursor-pointer',
    selectOption: 'bg-[#0a0a0a] text-[#00ff00]',
    pickerButton: 'flex items-center gap-2 bg-[#0a0a0a] border border-[#00ff00]/50 px-2 py-1 text-sm text-[#00ff00] hover:border-[#00ff00] hover:shadow-[0_0_6px_rgba(0,255,0,0.3)] cursor-pointer',
    pickerPanel: 'bg-[#0a0a0a] border border-[#00ff00]/40 p-4 sm:p-5 w-full max-w-5xl max-h-[85dvh] mx-3 sm:mx-4 flex flex-col shadow-[0_0_20px_rgba(0,255,0,0.1)]',
    pickerTitle: 'text-sm font-bold text-[#00ff00] uppercase tracking-[0.3em]',
    pickerClose: 'cursor-pointer text-[#00ff00]/50 hover:text-[#00ff00]',
    pickerCard: 'bg-[#0a0a0a] border border-[#00ff00]/30 hover:border-[#00ff00]/70 text-left cursor-pointer',
    pickerCardActive: 'border-[#00ff00] shadow-[0_0_8px_rgba(0,255,0,0.4)]',
    pickerCardLabel: 'block px-2 py-1.5 text-xs text-[#00ff00]/80 uppercase tracking-widest',
    pickerBadge: 'flex items-center gap-0.5 px-1 py-0.5 bg-[#0a0a0a] border border-[#00ff00]/30 text-[#00ff00]/40 hover:text-[#00ff00]/80 hover:border-[#00ff00]/60 cursor-pointer pointer-coarse:p-2',
    pickerBadgeActive: 'flex items-center gap-0.5 px-1 py-0.5 bg-[#0a0a0a] border border-[#00ff00] text-[#00ff00] shadow-[0_0_8px_rgba(0,255,0,0.4)] cursor-pointer pointer-coarse:p-2',
    settingsPanel: 'absolute top-0 right-0 bottom-0 w-full sm:w-80 overflow-y-auto overscroll-contain bg-[#0a0a0a] border-l border-[#00ff00]/20 p-5 transform transition-transform duration-300 z-50',
    settingsLabel: 'text-xs text-[#00ff00]/70 uppercase tracking-widest',
    settingsValue: 'text-xs text-[#00ff00] font-bold',
    settingsSlider: 'w-full accent-[#00ff00]',
    settingsDescription: 'text-[10px] text-[#00ff00]/30 mt-1 tracking-wide',
    settingsButton: 'w-full py-1.5 mt-4 bg-transparent border border-[#00ff00]/50 text-sm text-[#00ff00]/80 cursor-pointer hover:border-[#00ff00] hover:text-[#00ff00] hover:shadow-[0_0_8px_rgba(0,255,0,0.2)]',
    dialog: 'bg-[#0a0a0a] border border-[#00ff00]/40 p-5 w-full max-w-md space-y-4 mx-4 shadow-[0_0_20px_rgba(0,255,0,0.1)]',
    dialogOverlay: 'fixed inset-0 bg-black/90 z-[100] flex items-center justify-center',
    dialogInput: 'w-full bg-[#0a0a0a] border border-[#00ff00]/50 px-3 py-1.5 text-[#00ff00] text-sm placeholder-[#00ff00]/25 focus:outline-none focus:border-[#00ff00] focus:shadow-[0_0_6px_rgba(0,255,0,0.3)]',
    dialogButtonPrimary: 'px-4 py-1.5 bg-transparent border border-[#00ff00] text-sm text-[#00ff00] font-bold cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#00ff00]/10 hover:shadow-[0_0_8px_rgba(0,255,0,0.3)]',
    dialogButtonSecondary: 'px-4 py-1.5 bg-transparent border border-[#00ff00]/50 text-sm text-[#00ff00]/80 cursor-pointer hover:border-[#00ff00] hover:text-[#00ff00]',
    errorBanner: 'fixed w-max max-w-[calc(100vw-2rem)] top-6 left-1/2 -translate-x-1/2 bg-[#0a0a0a] border border-[#ff3333] text-[#ff3333] px-5 py-2 z-[110] flex items-center gap-3 text-sm shadow-[0_0_12px_rgba(255,51,51,0.3)]',
    mobileHint: 'md:hidden flex items-center justify-center gap-2 bg-[#0a0a0a] border-b border-[#ff3333]/30 px-4 py-1.5 text-xs text-[#ff3333]',
    title: 'text-base sm:text-lg font-bold uppercase tracking-[0.1em] sm:tracking-[0.2em] md:tracking-[0.3em] text-[#00ff00] truncate',
    subtitle: 'text-[10px] tracking-[0.2em] text-[#00ff00]/40',
    heroIcon: 'w-24 h-24 mx-auto border border-[#00ff00]/30 flex items-center justify-center bg-[#0a0a0a] shadow-[0_0_20px_rgba(0,255,0,0.1)]',
    heroTitle: 'text-2xl font-bold text-[#00ff00] tracking-wider',
    heroText: 'text-[#00ff00]/50 text-sm leading-relaxed tracking-wide',
    versionLabel: 'absolute bottom-3 left-4 text-[10px] tracking-[0.2em] text-[#00ff00]/20 pointer-events-none select-none z-40',
    atmosphericBg: false,
    sendspinBar: 'pointer-events-auto bg-[#0a0a0a] border border-[#00ff00]/30 px-5 py-2 max-w-full flex flex-col gap-1.5 shadow-[0_0_15px_rgba(0,255,0,0.05)]',
    sendspinTrackTitle: 'text-sm text-[#00ff00] truncate max-w-[70vw] sm:max-w-[200px] font-bold tracking-wide',
    sendspinTrackArtist: 'text-[10px] text-[#00ff00]/40 truncate max-w-[70vw] sm:max-w-[200px] tracking-wider',
    sendspinButton: 'p-1.5 border border-[#00ff00]/30 text-[#00ff00]/60 hover:text-[#00ff00] hover:border-[#00ff00]/60 cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed',
    sendspinButtonActive: 'text-[#00ff00] border-[#00ff00]',
    sendspinButtonOn: 'p-1.5 border border-[#00ff00] bg-[#00ff00]/10 text-[#00ff00] shadow-[0_0_6px_rgba(0,255,0,0.3)] cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed',
    sendspinPlayButton: 'p-1.5 border border-[#00ff00] text-[#00ff00] hover:shadow-[0_0_8px_rgba(0,255,0,0.3)] cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed',
    sendspinDivider: 'max-sm:hidden w-px h-5 bg-[#00ff00]/20',
    sendspinVolumeSlider: 'w-20 accent-[#00ff00] disabled:opacity-20',
    sendspinBarRow: 'flex flex-wrap sm:flex-nowrap justify-center items-center gap-x-4 gap-y-2',
    sendspinHandle: 'pointer-events-auto flex items-center px-3 -mb-px bg-[#0a0a0a] border border-b-0 border-[#00ff00]/30 text-[10px] uppercase tracking-[0.2em] text-[#00ff00]/60 hover:text-[#00ff00] cursor-pointer',
    sendspinTrackAlbum: 'text-[10px] text-[#00ff00]/30 tracking-wider truncate max-w-[70vw] sm:max-w-[200px] max-sm:hidden',
    sendspinStatus: 'text-[10px] uppercase tracking-[0.3em] text-[#00ff00] animate-pulse whitespace-nowrap',
    sendspinProgressTime: 'text-[10px] tabular-nums tracking-wider text-[#00ff00]/60 w-12 text-center flex-shrink-0',
    sendspinProgressTrack: 'relative flex-1 h-0.5 bg-[#00ff00]/15 overflow-hidden',
    sendspinProgressFill: 'absolute inset-y-0 left-0 bg-[#00ff00] shadow-[0_0_4px_rgba(0,255,0,0.6)]',
    sendspinSeekSlider: 'flex-1 min-w-0 accent-[#00ff00] cursor-pointer',
    sendspinPanel: 'pointer-events-auto mb-2 w-[calc(100vw-1rem)] sm:w-[28rem] max-h-[min(60dvh,28rem)] flex flex-col gap-2 bg-[#0a0a0a] border border-[#00ff00]/40 p-3 shadow-[0_0_20px_rgba(0,255,0,0.1)]',
    sendspinPanelTitle: 'text-xs font-bold text-[#00ff00] uppercase tracking-[0.3em]',
    sendspinTab: 'px-2 py-0.5 text-[10px] uppercase tracking-widest bg-transparent border border-[#00ff00]/30 text-[#00ff00]/60 cursor-pointer hover:border-[#00ff00]/60 hover:text-[#00ff00]',
    sendspinTabActive: 'px-2 py-0.5 text-[10px] uppercase tracking-widest bg-[#00ff00]/10 border border-[#00ff00] text-[#00ff00] cursor-pointer shadow-[0_0_6px_rgba(0,255,0,0.3)]',
    sendspinListItem: 'w-full flex items-center gap-2 px-2 py-1 text-left text-sm text-[#00ff00]/70 hover:text-[#00ff00] hover:bg-[#00ff00]/5 cursor-pointer disabled:opacity-40 disabled:cursor-wait',
    sendspinListItemActive: 'text-[#00ff00] bg-[#00ff00]/10',
    sendspinListMeta: 'text-[10px] tracking-wider text-[#00ff00]/40 truncate',
  },
};
