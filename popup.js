// Charger et afficher les statistiques
function loadStats() {
  chrome.storage.local.get(['extractedEmails', 'processedEmails'], (result) => {
    const emailCount = (result.extractedEmails || []).length;
    const processedCount = (result.processedEmails || []).length;

    document.getElementById('emailCount').textContent = emailCount;
    document.getElementById('processedCount').textContent = processedCount;

    displayEmails(result.extractedEmails || []);
  });
}

// Afficher la liste des emails
function displayEmails(emails) {
  const emailList = document.getElementById('emailList');
  
  if (emails.length === 0) {
    emailList.innerHTML = '<p class="empty">Aucun email capturé pour le moment...</p>';
    return;
  }

  emailList.innerHTML = emails
    .slice()
    .reverse()
    .map((email, index) => {
      const date = new Date(email.timestamp);
      const timeStr = date.toLocaleString('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <div class="email-item">
          <div class="email-item-subject">📧 ${escapeHtml(email.subject)}</div>
          <div class="email-item-sender">De: ${escapeHtml(email.sender)}</div>
          <div class="email-item-time">${timeStr}</div>
        </div>
      `;
    })
    .join('');
}

// Échapper HTML pour éviter les injections
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Vider les données
document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('⚠️ Êtes-vous sûr de vouloir vider toutes les données ?')) {
    chrome.storage.local.clear(() => {
      console.log('✅ Données effacées');
      loadStats();
    });
  }
});

// Exporter les emails
document.getElementById('exportBtn').addEventListener('click', () => {
  chrome.storage.local.get(['extractedEmails'], (result) => {
    const emails = result.extractedEmails || [];
    
    if (emails.length === 0) {
      alert('Aucun email à exporter');
      return;
    }

    const dataStr = JSON.stringify(emails, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `emails_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    
    URL.revokeObjectURL(url);
  });
});

// Voir la console
document.getElementById('logsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage?.() || alert('Consultez la console des DevTools (F12)');
});

// Charger les stats au démarrage
loadStats();

// Rafraîchir chaque 2 secondes
setInterval(loadStats, 2000);