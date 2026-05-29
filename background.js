// Service Worker pour l'extension

// Écouter les messages du content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EMAIL_EXTRACTED') {
    console.log('📩 Email reçu depuis le content script:', message.data);
    
    // Sauvegarder l'email extrait
    chrome.storage.local.get('extractedEmails', (result) => {
      const emails = result.extractedEmails || [];
      emails.push(message.data);
      
      chrome.storage.local.set({
        extractedEmails: emails
      });
      
      console.log('💾 Email sauvegardé. Total:', emails.length);
    });
    
    sendResponse({ success: true });
  }
});

// Nettoyer les données au démarrage (optionnel)
chrome.runtime.onInstalled.addListener(() => {
  console.log('🔧 Extension installée/mise à jour');
  
  chrome.storage.local.get(null, (items) => {
    console.log('📊 État du stockage:', items);
  });
});