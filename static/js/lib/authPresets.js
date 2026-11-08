export const AUTH_PRESETS = [
  { label: '*arr apps', type: 'header', name: 'X-Api-Key' },
  { label: 'Jellyfin', type: 'header', name: 'X-Emby-Token' },
  { label: 'Plex', type: 'query', name: 'X-Plex-Token' },
  { label: 'SABnzbd', type: 'query', name: 'apikey' },
  { label: 'Home Assistant', type: 'bearer', name: '' },
];

export const AUTH_METHODS = [
  { type: 'header', label: 'Header' },
  { type: 'query', label: 'Query param' },
  { type: 'bearer', label: 'Bearer' },
  { type: 'basic', label: 'Basic auth' },
  { type: 'none', label: 'None' },
];
