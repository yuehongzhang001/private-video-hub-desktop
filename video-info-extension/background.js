// Background service worker for Private Video Hub extension
// Handles extension lifecycle and message coordination

chrome.runtime.onInstalled.addListener(() => {
  console.log('Private Video Hub extension installed');
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);
  return true;
});
