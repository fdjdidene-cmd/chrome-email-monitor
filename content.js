// Stockage des emails déjà traités
let processedEmails = new Set();
let currentEmailId = null;
let isDetailViewOpen = false;

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
    // Conteneur principal de l'email (tu l'as fourni)
    emailContainerSelector: 'div.nH > div.l2',
    // Détecte si on est dans la vue détail
    detailViewSelector: '[role="main"] [data-message-id]',
    // Sélecteurs DANS le conteneur
    subjectSelector: 'h2, .hP',
    senderSelector: '.gD.gE span, .go span',
    contentSelector: '.aHl .a3s, .h5',
    attachmentSelector: '.aZo',
    maxRetries: 10,
    retryDelay: 500
  },
  OUTLOOK: {
    emailContainerSelector: '[role="main"] [role="article"]',
    detailViewSelector: '[role="main"] [role="article"]',
    subjectSelector: '[data-automationid="subject"]',
    senderSelector: '[data-automationid="from"] span',
    contentSelector: '[data-automationid="body"], .messageBody',
    attachmentSelector: '[data-automationid="attachmentList"] [role="link"]',
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
 * Vérifie si on est dans la vue détail d'un email
 */
function isEmailDetailViewOpen(service) {
  const config = CONFIG[service];
  const detailElement = document.querySelector(config.detailViewSelector);
  
  if (!detailElement) {
    console.log('📋 Vue liste des emails - pas de traitement');
    return false;
  }
  
  console.log('📧 Vue détail d\'un email détectée');
  return true;
}

/**
 * Récupère le conteneur principal de l'email
 */
function getEmailContainer(service) {
  const config = CONFIG[service];
  const container = document.querySelector(config.emailContainerSelector);
  
  if (!container) {
    console.warn('⚠️ Conteneur email non trouvé:', config.emailContainerSelector);
    return null;
  }
  
  return container;
}

/**
 * Génère un hash unique pour l'email
 */
function generateEmailHash(subject, sender) {
  return `${subject}_${sender}`.replace(/\s+/g, '_').substring(0, 100);
}

/**
 * Extrait les informations d'un email Gmail DEPUIS LE CONTENEUR
 */
function extractGmailEmail() {
  try {
    const config = CONFIG.GMAIL;
    
    // Récupérer le conteneur
    const container = getEmailContainer('GMAIL');
    if (!container) return null;

    console.log('🔎 Extraction depuis le conteneur Gmail:', container);
    
    // Sujet - rechercher DANS le conteneur
    const subjectElement = container.querySelector(config.subjectSelector);
    const subject = subjectElement?.innerText?.trim() || 'Sujet inconnu';

    // Expéditeur - rechercher DANS le conteneur
    const senderElement = container.querySelector(config.senderSelector);
    const sender = senderElement?.innerText?.trim() || 'Expéditeur inconnu';

    // Contenu du mail - rechercher DANS le conteneur
    const contentElement = container.querySelector(config.contentSelector);
    const content = contentElement?.innerText?.trim() || 'Contenu non disponible';

    // Pièces jointes - rechercher DANS le conteneur
    const attachmentElements = container.querySelectorAll(config.attachmentSelector);
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
 * Extrait les informations d'un email Outlook DEPUIS LE CONTENEUR
 */
function extractOutlookEmail() {
  try {
    const config = CONFIG.OUTLOOK;
    
    // Récupérer le conteneur
    const container = getEmailContainer('OUTLOOK');
    if (!container) return null;

    console.log('🔎 Extraction depuis le conteneur Outlook:', container);
    
    // Sujet - rechercher DANS le conteneur
    const subjectElement = container.querySelector(config.subjectSelector);
    const subject = subjectElement?.innerText?.trim() || 'Sujet inconnu';

    // Expéditeur - rechercher DANS le conteneur
    const senderElement = container.querySelector(config.senderSelector);
    const sender = senderElement?.innerText?.trim() || 'Expéditeur inconnu';

    // Contenu du mail - rechercher DANS le conteneur
    const contentElement = container.querySelector(config.contentSelector);
    const content = contentElement?.innerText?.trim() || 'Contenu non disponible';

    // Pièces jointes - rechercher DANS le conteneur
    const attachmentElements = container.querySelectorAll(config.attachmentSelector);
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

  // Vérifier si le conteneur est chargé
  const container = getEmailContainer(service);
  
  if (!container && retries < config.maxRetries) {
    console.log(`⏳ Email pas encore chargé (${service})... tentative ${retries + 1}/${config.maxRetries}`);
    await new Promise(resolve => setTimeout(resolve, config.retryDelay));
    return waitForEmailToLoad(service, retries + 1);
  }

  if (!container) {
    console.warn('⚠️ Impossible de charger le mail après plusieurs tentatives');
    return null;
  }

  // Vérifier que le sujet est présent dans le conteneur
  const subjectElement = container.querySelector(CONFIG[service].subjectSelector);
  if (!subjectElement && retries < config.maxRetries) {
    console.log(`⏳ Sujet pas encore disponible (${service})... tentative ${retries + 1}/${config.maxRetries}`);
    await new Promise(resolve => setTimeout(resolve, config.retryDelay));
    return waitForEmailToLoad(service, retries + 1);
  }

  // Attendre que le contenu soit complètement rendu
  await new Promise(resolve => setTimeout(resolve, 800));
  
  return container;
}

/**
 * Traite un email détecté (UNIQUEMENT en vue détail)
 */
async function processEmail(service) {
  try {
    // ✅ VÉRIFICATION CLÉE: On n'extrait QUE si on est en vue détail
    if (!isEmailDetailViewOpen(service)) {
      return;
    }

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
 * UNIQUEMENT active en vue détail
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
  let lastDetailViewState = false;

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

    // Vérifier l'état de la vue détail
    const isDetailNow = isEmailDetailViewOpen(emailService);
    
    // Si on vient de passer en vue détail, traiter l'email
    if (isDetailNow && !lastDetailViewState) {
      console.log('👁️  Entrée en vue détail - activation du traitement');
      processEmail(emailService);
    }
    
    // Si on est en vue détail, vérifier les changements d'email
    if (isDetailNow) {
      processEmail(emailService);
    }
    
    // Si on sort de la vue détail, réinitialiser
    if (!isDetailNow && lastDetailViewState) {
      console.log('👈 Retour à la liste - pause du traitement');
      currentEmailId = null;
    }
    
    lastDetailViewState = isDetailNow;
  }, 300);

  console.log('👁️  Surveillance activée - UNIQUEMENT sur vue détail');
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
