// Stockage des emails déjà traités (clé = identifiant unique du mail)
let processedEmails = new Set();

// Charger les emails traités depuis le stockage
chrome.storage.local.get('processedEmails', (result) => {
  if (result.processedEmails) {
    processedEmails = new Set(result.processedEmails);
    console.log('✅ Emails traités chargés:', processedEmails.size, 'email(s)');
  }
});

// Configuration des délais d'attente pour différents services
const CONFIG = {
  GMAIL: {
    emailSelector: '[role="main"] [data-message-id]',
    maxRetries: 10,
    retryDelay: 500
  },
  OUTLOOK: {
    emailSelector: '[role="main"] .itemRow, [role="main"] [role="article"]',
    maxRetries: 10,
    retryDelay: 500
  }
};

/**
 * Détecte le service email utilisé
 */
function detectEmailService() {
  if (window.location.hostname.includes('mail.google.com')) {
    return 'GMAIL';
  } else if (window.location.hostname.includes('outlook')) {
    return 'OUTLOOK';
  }
  return null;
}

/**
 * Extrait l'identifiant unique du mail actuellement ouvert
 */
function getCurrentEmailId() {
  const emailService = detectEmailService();
  
  if (emailService === 'GMAIL') {
    // Gmail: utilise data-message-id
    const messageElement = document.querySelector('[role="main"] [data-message-id]');
    return messageElement?.getAttribute('data-message-id');
  } else if (emailService === 'OUTLOOK') {
    // Outlook: utilise un identifiant interne
    const itemElement = document.querySelector('[role="main"] [data-item-id]');
    return itemElement?.getAttribute('data-item-id');
  }
  return null;
}

/**
 * Extrait les informations d'un email Gmail
 */
function extractGmailEmail() {
  try {
    // Sujet
    const subjectElement = document.querySelector('[role="main"] .aHl h2, [role="main"] .hP');
    const subject = subjectElement?.innerText?.trim() || 'Sujet inconnu';

    // Expéditeur
    const fromElement = document.querySelector('[role="main"] .gD.gE span, [role="main"] .go span');
    const sender = fromElement?.innerText?.trim() || 'Expéditeur inconnu';

    // Contenu du mail
    const contentElement = document.querySelector('[role="main"] .aHl .a3s, [role="main"] .h5');
    const content = contentElement?.innerText?.trim() || 'Contenu non disponible';

    // Pièces jointes
    const attachmentElements = document.querySelectorAll('[role="main"] .aZo');
    const attachments = Array.from(attachmentElements).map(el => ({
      name: el.getAttribute('download') || el.innerText.trim(),
      size: el.closest('.aZo')?.querySelector('.tS')?.innerText?.trim() || 'Taille inconnue'
    }));

    return {
      service: 'Gmail',
      subject,
      sender,
      content,
      attachments,
      attachmentCount: attachments.length,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Erreur extraction Gmail:', error);
    return null;
  }
}

/**
 * Extrait les informations d'un email Outlook
 */
function extractOutlookEmail() {
  try {
    // Sujet
    const subjectElement = document.querySelector('[role="main"] [data-automationid="subject"]');
    const subject = subjectElement?.innerText?.trim() || 'Sujet inconnu';

    // Expéditeur
    const senderElement = document.querySelector('[role="main"] [data-automationid="from"] span, [role="main"] .peoplePickerPersona');
    const sender = senderElement?.innerText?.trim() || 'Expéditeur inconnu';

    // Contenu du mail
    const contentElement = document.querySelector('[role="main"] [data-automationid="body"], [role="main"] .messageBody');
    const content = contentElement?.innerText?.trim() || 'Contenu non disponible';

    // Pièces jointes
    const attachmentElements = document.querySelectorAll('[role="main"] [data-automationid="attachmentList"] [role="link"], [role="main"] .attachmentThumbnail');
    const attachments = Array.from(attachmentElements).map(el => ({
      name: el.innerText?.trim() || el.getAttribute('aria-label') || 'Fichier inconnu',
      size: el.closest('div')?.querySelector('.attachmentSize')?.innerText?.trim() || 'Taille inconnue'
    }));

    return {
      service: 'Outlook',
      subject,
      sender,
      content,
      attachments,
      attachmentCount: attachments.length,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Erreur extraction Outlook:', error);
    return null;
  }
}

/**
 * Génère un identifiant unique pour l'email
 */
function generateEmailId(emailData) {
  return `${emailData.subject}_${emailData.sender}_${new Date().toDateString()}`;
}

/**
 * Attend le chargement complet du mail avec retry
 */
async function waitForEmailToLoad(service, retries = 0) {
  const config = CONFIG[service];
  
  if (!config) return null;

  // Vérifier si le mail est chargé
  const emailElement = document.querySelector(config.emailSelector);
  
  if (!emailElement && retries < config.maxRetries) {
    console.log(`⏳ Email pas encore chargé (${service})... tentative ${retries + 1}/${config.maxRetries}`);
    await new Promise(resolve => setTimeout(resolve, config.retryDelay));
    return waitForEmailToLoad(service, retries + 1);
  }

  if (!emailElement) {
    console.warn('⚠️ Impossible de charger le mail après plusieurs tentatives');
    return null;
  }

  // Attendre que le contenu soit complètement rendu
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return emailElement;
}

/**
 * Traite un email détecté
 */
async function processEmail(service) {
  try {
    console.log('🔍 Nouveau mail détecté (' + service + ')...');
    
    // Attendre le chargement complet
    const emailElement = await waitForEmailToLoad(service);
    if (!emailElement) return;

    // Obtenir l'ID unique du mail actuellement ouvert
    const currentEmailId = getCurrentEmailId();
    
    if (!currentEmailId) {
      console.warn('⚠️ Impossible de déterminer l\'ID unique du mail');
      return;
    }

    // Vérifier si c'est un mail différent que celui précédemment ouvert
    if (window.lastProcessedEmailId === currentEmailId) {
      console.log('⏭️  Même email déjà traité, pas de re-extraction');
      return;
    }

    // C'est un nouvel email, on l'extrait
    window.lastProcessedEmailId = currentEmailId;

    // Extraire les informations
    let emailData;
    if (service === 'GMAIL') {
      emailData = extractGmailEmail();
    } else if (service === 'OUTLOOK') {
      emailData = extractOutlookEmail();
    }

    if (!emailData) return;

    // Générer ID unique pour le stockage
    const emailStorageId = generateEmailId(emailData);

    // Marquer comme traité
    processedEmails.add(emailStorageId);
    
    // Sauvegarder dans le stockage
    chrome.storage.local.set({
      processedEmails: Array.from(processedEmails)
    });

    // Afficher le résultat
    console.log('✅ EMAIL EXTRAIT AVEC SUCCÈS');
    console.log('═'.repeat(60));
    console.log(JSON.stringify(emailData, null, 2));
    console.log('═'.repeat(60));

    // Envoyer au background script
    chrome.runtime.sendMessage({
      type: 'EMAIL_EXTRACTED',
      data: emailData
    }).catch(() => {
      // Le background script n'est pas disponible, c'est OK
    });

  } catch (error) {
    console.error('❌ Erreur lors du traitement du mail:', error);
  }
}

/**
 * Monitore les changements de DOM pour détecter l'ouverture d'emails
 */
function initializeEmailMonitor() {
  const emailService = detectEmailService();
  
  if (!emailService) {
    console.warn('⚠️ Service email non détecté');
    return;
  }

  console.log('🚀 Email Monitor initialisé pour:', emailService);

  // Observer pour les changements de DOM
  const observer = new MutationObserver((mutations) => {
    // Dédupliquer les appels avec un délai
    clearTimeout(observer.processTimeout);
    observer.processTimeout = setTimeout(() => {
      processEmail(emailService);
    }, 500);
  });

  // Configuration de l'observer
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-message-id', 'data-item-id', 'role'],
    characterData: false
  });

  console.log('👁️  Surveillance activée - ouverture d\'email détectée automatiquement');
}

// Initialiser quand le DOM est prêt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeEmailMonitor);
} else {
  initializeEmailMonitor();
}

// Traiter l'email initial au chargement
setTimeout(() => {
  const service = detectEmailService();
  if (service) {
    processEmail(service);
  }
}, 2000);