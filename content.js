// Stockage des emails déjà traités
let processedEmails = new Set();
let currentEmailId = null;

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
    subjectSelector: '[role="main"] h2, [role="main"] .hP',
    senderSelector: '[role="main"] .gD.gE span, [role="main"] .go span',
    contentSelector: '[role="main"] .aHl .a3s, [role="main"] .h5',
    attachmentSelector: '[role="main"] .aZo',
    maxRetries: 10,
    retryDelay: 500
  },
  OUTLOOK: {
    subjectSelector: '[role="main"] [data-automationid="subject"]',
    senderSelector: '[role="main"] [data-automationid="from"] span',
    contentSelector: '[role="main"] [data-automationid="body"], [role="main"] .messageBody',
    attachmentSelector: '[role="main"] [data-automationid="attachmentList"] [role="link"]',
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
 * Génère un hash unique pour l'email
 */
function generateEmailHash(subject, sender) {
  return `${subject}_${sender}`.replace(/\s+/g, '_').substring(0, 100);
}

/**
 * Extrait les informations d'un email Gmail
 */
function extractGmailEmail() {
  try {
    const config = CONFIG.GMAIL;
    
    // Sujet
    const subjectElement = document.querySelector(config.subjectSelector);
    const subject = subjectElement?.innerText?.trim() || 'Sujet inconnu';

    // Expéditeur
    const senderElement = document.querySelector(config.senderSelector);
    const sender = senderElement?.innerText?.trim() || 'Expéditeur inconnu';

    // Contenu du mail
    const contentElement = document.querySelector(config.contentSelector);
    const content = contentElement?.innerText?.trim() || 'Contenu non disponible';

    // Pièces jointes
    const attachmentElements = document.querySelectorAll(config.attachmentSelector);
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
    const config = CONFIG.OUTLOOK;
    
    // Sujet
    const subjectElement = document.querySelector(config.subjectSelector);
    const subject = subjectElement?.innerText?.trim() || 'Sujet inconnu';

    // Expéditeur
    const senderElement = document.querySelector(config.senderSelector);
    const sender = senderElement?.innerText?.trim() || 'Expéditeur inconnu';

    // Contenu du mail
    const contentElement = document.querySelector(config.contentSelector);
    const content = contentElement?.innerText?.trim() || 'Contenu non disponible';

    // Pièces jointes
    const attachmentElements = document.querySelectorAll(config.attachmentSelector);
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
 * Attend le chargement complet du mail avec retry
 */
async function waitForEmailToLoad(service, retries = 0) {
  const config = CONFIG[service];
  
  if (!config) return null;

  // Vérifier si le sujet est chargé
  const subjectElement = document.querySelector(config.subjectSelector);
  
  if (!subjectElement && retries < config.maxRetries) {
    console.log(`⏳ Email pas encore chargé (${service})... tentative ${retries + 1}/${config.maxRetries}`);
    await new Promise(resolve => setTimeout(resolve, config.retryDelay));
    return waitForEmailToLoad(service, retries + 1);
  }

  if (!subjectElement) {
    console.warn('⚠️ Impossible de charger le mail après plusieurs tentatives');
    return null;
  }

  // Attendre que le contenu soit complètement rendu
  await new Promise(resolve => setTimeout(resolve, 800));
  
  return subjectElement;
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

    // Extraire les informations
    let emailData;
    if (service === 'GMAIL') {
      emailData = extractGmailEmail();
    } else if (service === 'OUTLOOK') {
      emailData = extractOutlookEmail();
    }

    if (!emailData) return;

    // Générer ID unique
    const emailHash = generateEmailHash(emailData.subject, emailData.sender);

    // Vérifier si c'est un nouvel email
    if (currentEmailId === emailHash) {
      console.log('⏭️  Même email déjà traité, pas de re-extraction:', emailData.subject);
      return;
    }

    // C'est un nouvel email
    currentEmailId = emailHash;
    
    // Marquer comme traité
    processedEmails.add(emailHash);
    
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
 * Monitore les changements avec intervalle (évite les warnings)
 */
function initializeEmailMonitor() {
  const emailService = detectEmailService();
  
  if (!emailService) {
    console.warn('⚠️ Service email non détecté');
    return;
  }

  console.log('🚀 Email Monitor initialisé pour:', emailService);

  // Utiliser un intervalle au lieu de MutationObserver pour éviter le warning
  let lastCheckedTime = 0;
  const checkInterval = setInterval(() => {
    const now = Date.now();
    
    // Vérifier toutes les 1 seconde au maximum
    if (now - lastCheckedTime < 1000) return;
    lastCheckedTime = now;

    // Vérifier si on est toujours sur la même page
    if (!detectEmailService()) {
      clearInterval(checkInterval);
      return;
    }

    processEmail(emailService);
  }, 300);

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

// Nettoyer en cas de changement d'URL
window.addEventListener('hashchange', () => {
  currentEmailId = null;
}, false);
