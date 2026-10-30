/* Curated calm palettes and mood suggestions. */
window.Still = window.Still || {};
Still.palettes = [
  { name: 'Morning Mist', colors: ['#e8eef2', '#c9d6df', '#a7bccb', '#7f9cb0', '#5a7a91', '#f3e3d3', '#e7c9b0', '#c99f84'] },
  { name: 'Sage Garden', colors: ['#eef2e6', '#cfdcc0', '#a9c19b', '#7fa279', '#58805a', '#3e5e44', '#e9dcc0', '#c7b28a'] },
  { name: 'Tidepool', colors: ['#e3f1f1', '#b7dedd', '#83c5c4', '#4fa3a5', '#2f7c86', '#1f5560', '#f6d7c3', '#ef9f8c'] },
  { name: 'Lavender Dusk', colors: ['#f1ecf6', '#d9cbe8', '#b9a3d6', '#9479bf', '#6c5a9c', '#433b6b', '#f7d6e0', '#e3a6bd'] },
  { name: 'Terracotta', colors: ['#f7ebe1', '#efd0b8', '#e0a988', '#c97f5d', '#a3593d', '#6e3b2a', '#d9c7a1', '#8b9a74'] },
  { name: 'Northern Night', colors: ['#dfe7f2', '#a9bcd9', '#6f8fbf', '#41639b', '#263f6e', '#151f3a', '#9fd9c9', '#f1e6a6'] },
  { name: 'Autumn Maple', colors: ['#fbe9c6', '#f4c27a', '#e8964a', '#cf6a30', '#a3432a', '#6b2b25', '#a7a36a', '#5e6b3f'] },
  { name: 'Relax Pastel', colors: ['#fdf6ec', '#f6e1d3', '#efc9c4', '#dcd3ec', '#c8dcef', '#cfe8de', '#f4ecc2', '#e3d5c8'] },
  { name: 'Petal Soft', colors: ['#fff3f0', '#fbd9d3', '#f5b5ad', '#ea8f8f', '#c96f7d', '#f8edd3', '#d8e6cf', '#bcd3e8'] }
];
/* Mood → palette + a gentle note (fully visual, no audio). */
Still.moods = [
  { id: 'tired', label: 'Tired', emoji: '🌙', palette: 'Northern Night', note: 'Deep, quiet blues to slow down.' },
  { id: 'anxious', label: 'Anxious', emoji: '🌊', palette: 'Tidepool', note: 'Cool water tones to settle the mind.' },
  { id: 'low', label: 'Low', emoji: '🌤', palette: 'Autumn Maple', note: 'Warm, sunny colors to lift you a little.' },
  { id: 'calm', label: 'Calm', emoji: '🌿', palette: 'Sage Garden', note: 'Soft greens to stay in the flow.' },
  { id: 'happy', label: 'Happy', emoji: '🌸', palette: 'Petal Soft', note: 'Light petals for a bright mood.' },
  { id: 'dreamy', label: 'Dreamy', emoji: '✨', palette: 'Lavender Dusk', note: 'Lavender and rose for daydreams.' }
];
