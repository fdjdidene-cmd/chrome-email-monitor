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
    // Conteneur principal de l'email
    emailContainerSelector: 'div.nH > div.l2',
    // Détecte si on est dans la vue détail
    detailViewSelector: '[role="main"] [data-message-id]',
    // Sélecteurs DANS le conteneur - multiples options
    subjectSelectors: [
      'h2',                    // Standard Gmail
      '.hP',                   // Alternative
      '[data-subject]',        // Avec attribut
      'span[data-is-subject="true"]',  // Attribut spécifique
      '.aHl h2'               // Dans le conteneur aHl
    ],
    senderSelectors: [
      '.gD.gE span',           // Standard
      '.go span',              // Alternative
      '[data-email]',          // Avec email
      '.yP',                   // Alternative
      '.gD span'               // Simpler
    ],
    contentSelectors: [
      '.aHl .a3s',             // Standard Gmail
      '.h5',                   // Alternative
      '[role="article"]',      // Article
      '.msg',                  // Message
      '.aHl'                   // Conteneur du message
    ],
    attachmentSelectors: [
      '.aZo',                  // Standard
      '[data-attachment-id]',  // Avec ID
      '.aVn'                   // Alternative
    ],
    maxRetries: 15,
    retryDelay: 300
  },
  OUTLOOK: {
    emailContainerSelector: '[role="main"] [role="article"]',
    detailViewSelector: '[role="main"] [role="article"]',
    subjectSelectors: [
      '[data-automationid="subject"]',
      'h1',
      '[role="heading"]'
    ],
    senderSelectors: [
      '[data-automationid="from"] span',
      '.peoplePickerPersona',
      '[data-automationid="from"]'
    ],
    contentSelectors: [
      '[data-automationid="body"]',
      '.messageBody',
      '[role="article"] div'
    ],
    attachmentSelectors: [
      '[data-automationid="attachmentList"] [role="link"]',
      '.attachmentThumbnail'
    ],
    maxRetries: 15,
    retryDelay: 300
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
 * Essaie plusieurs sélecteurs pour trouver un élément
 */
function findElementWithMultipleSelectors(container, selectors) {
  for (const selector of selectors) {
    try {
      const element = container.querySelector(selector);
      if (element && element.innerText?.trim()) {
        console.log('✅ Trouvé avec sélecteur:', selector);
        return element;
      }
    } catch (e) {
      // Continuer avec le prochain sélecteur
    }
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
 * Affiche les informations dans une boîte en bas de la page
 */
function displayEmailInfoInPage(emailData) {
  // Supprimer la boîte précédente s'il y en a une
  const oldBox = document.getElementById('email-monitor-box');
  if (oldBox) {
    oldBox.remove();
  }

  // Créer la boîte d'affichage
  const box = document.createElement('div');
  box.id = 'email-monitor-box';
  box.style.cssText = `
    position: fixed;
    bottom: 0;
    right: 0;
    width: 400px;
    max-height: 50vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px;
    border-radius: 10px 10px 0 0;
    box-shadow: 0 -4px 15px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow-y: auto;
    border: 1px solid rgba(255, 255, 255, 0.2);
  `;

  // Contenu de la boîte
  const attachmentsHTML = emailData.attachments && emailData.attachments.length > 0
    ? emailData.attachments.map(att => `
        <div style="background: rgba(255,255,255,0.1); padding: 8px; margin: 5px 0; border-radius: 4px; font-size: 12px;">
          📎 ${escapeHtml(att.name)} <span style="opacity: 0.7;">(${escapeHtml(att.size)})</span>
        </div>
      `).join('')
    : '<div style="opacity: 0.8; font-size: 12px;">Aucune pièce jointe</div>';

  box.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
      <h3 style="margin: 0; font-size: 18px;">✅ EMAIL EXTRAIT</h3>
      <button id="close-email-box" style="
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        width: 30px;
        height: 30px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">✕</button>
    </div>

    <div style="border-left: 3px solid rgba(255,255,255,0.3); padding-left: 12px; margin-bottom: 12px;">
      <div style="margin-bottom: 10px;">
        <span style="opacity: 0.8; font-size: 12px;">SUJET</span>
        <div style="font-weight: 600; margin-top: 3px; word-break: break-word;">${escapeHtml(emailData.subject)}</div>
      </div>
      
      <div style="margin-bottom: 10px;">
        <span style="opacity: 0.8; font-size: 12px;">EXPÉDITEUR</span>
        <div style="font-weight: 600; margin-top: 3px; word-break: break-word;">${escapeHtml(emailData.sender)}</div>
      </div>

      <div style="margin-bottom: 10px;">
        <span style="opacity: 0.8; font-size: 12px;">SERVICE</span>
        <div style="font-weight: 600; margin-top: 3px;">${escapeHtml(emailData.service)}</div>
      </div>

      <div style="margin-bottom: 10px;">
        <span style="opacity: 0.8; font-size: 12px;">HORODATAGE</span>
        <div style="font-weight: 600; margin-top: 3px; font-size: 12px;">${new Date(emailData.timestamp).toLocaleString('fr-FR')}</div>
      </div>
    </div>

    <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 4px; margin-bottom: 12px;">
      <span style="opacity: 0.8; font-size: 12px; display: block; margin-bottom: 8px;">CONTENU</span>
      <div style="font-size: 13px; max-height: 120px; overflow-y: auto; word-break: break-word; line-height: 1.4;">
        ${escapeHtml(emailData.content.substring(0, 500))}${emailData.content.length > 500 ? '...' : ''}
      </div>
    </div>

    <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 4px;">
      <span style="opacity: 0.8; font-size: 12px; display: block; margin-bottom: 8px;">PIÈCES JOINTES (${emailData.attachmentCount})</span>
      ${attachmentsHTML}
    </div>
  `;

  // Ajouter la boîte au DOM
  document.body.appendChild(box);

  // Bouton de fermeture
  document.getElementById('close-email-box').addEventListener('click', () => {
    box.remove();
  });
}

/**
 * Échappe le texte HTML pour éviter les injections
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

    console.log('🔎 Extraction depuis le conteneur Gmail');
    console.log('📦 Conteneur:', container);
    
    // Sujet - essayer plusieurs sélecteurs
    const subjectElement = findElementWithMultipleSelectors(container, config.subjectSelectors);
    const subject = subjectElement?.innerText?.trim() || 'Sujet inconnu';
    console.log('📌 Sujet trouvé:', subject);

    // Expéditeur - essayer plusieurs sélecteurs
    const senderElement = findElementWithMultipleSelectors(container, config.senderSelectors);
    const sender = senderElement?.innerText?.trim() || 'Expéditeur inconnu';
    console.log('👤 Expéditeur trouvé:', sender);

    // Contenu du mail - essayer plusieurs sélecteurs
    const contentElement = findElementWithMultipleSelectors(container, config.contentSelectors);
    const content = contentElement?.innerText?.trim() || 'Contenu non disponible';
    console.log('📝 Contenu trouvé (longueur):', content.length);

    // Pièces jointes - essayer plusieurs sélecteurs
    let attachmentElements = [];
    for (const selector of config.attachmentSelectors) {
      try {
        attachmentElements = Array.from(container.querySelectorAll(selector));
        if (attachmentElements.length > 0) {
          console.log('✅ Pièces jointes trouvées avec:', selector);
          break;
        }
      } catch (e) {
        // Continuer
      }
    }

    const attachments = attachmentElements.map(el => ({
      name: el.getAttribute('download') || el.innerText.trim(),
      size: el.closest('.aZo')?.querySelector('.tS')?.innerText?.trim() || 'Taille inconnue'
    }));

    console.log('📎 Nombre de pièces jointes:', attachments.length);

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

    console.log('🔎 Extraction depuis le conteneur Outlook');
    
    // Sujet
    const subjectElement = findElementWithMultipleSelectors(container, config.subjectSelectors);
    const subject = subjectElement?.innerText?.trim() || 'Sujet inconnu';

    // Expéditeur
    const senderElement = findElementWithMultipleSelectors(container, config.senderSelectors);
    const sender = senderElement?.innerText?.trim() || 'Expéditeur inconnu';

    // Contenu du mail
    const contentElement = findElementWithMultipleSelectors(container, config.contentSelectors);
    const content = contentElement?.innerText?.trim() || 'Contenu non disponible';

    // Pièces jointes
    let attachmentElements = [];
    for (const selector of config.attachmentSelectors) {
      try {
        attachmentElements = Array.from(container.querySelectorAll(selector));
        if (attachmentElements.length > 0) break;
      } catch (e) {
        // Continuer
      }
    }

    const attachments = attachmentElements.map(el => ({
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
  let subjectFound = false;
  for (const selector of CONFIG[service].subjectSelectors) {
    if (container.querySelector(selector)?.innerText?.trim()) {
      subjectFound = true;
      break;
    }
  }

  if (!subjectFound && retries < config.maxRetries) {
    console.log(`⏳ Sujet pas encore disponible (${service})... tentative ${retries + 1}/${config.maxRetries}`);
    await new Promise(resolve => setTimeout(resolve, config.retryDelay));
    return waitForEmailToLoad(service, retries + 1);
  }

  // Attendre que le contenu soit complètement rendu
  await new Promise(resolve => setTimeout(resolve, 1000));
  
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

    // Afficher le résultat EN CONSOLE
    console.log('✅ EMAIL EXTRAIT AVEC SUCCÈS');
    console.log('═'.repeat(60));
    console.log(JSON.stringify(emailData, null, 2));
    console.log('═'.repeat(60));

    // Afficher le résultat DANS LA PAGE
    displayEmailInfoInPage(emailData);

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
