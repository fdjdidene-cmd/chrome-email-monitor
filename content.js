// Stockage des emails déjà traités
let processedEmails = new Set();
let currentEmailId = null;
let isDetailViewOpen = false;

// Charger les emails traités depuis le stockage
chrome.storage.local.get('processedEmails', (result) => {
  if (result.processedEmails) {
    processedEmails = new Set(result.processedEmails);
  }
});

// Configuration des délais d'attente pour différents services
const CONFIG = {
  GMAIL: {
    // Conteneur principal de l'email - CORRIGÉ
    emailContainerSelector: 'div.ha',
    // Détecte si on est dans la vue détail
    detailViewSelector: '[role="main"] [data-message-id]',
    // Sélecteurs DANS le conteneur - multiples options
    subjectSelectors: [
      '.hP',                   // ✅ Principal (h2.hP)
      'h2.hP',                 // ✅ Plus spécifique
      'h2',                    // Alternative
      '[data-subject]',        // Avec attribut
      'span[data-is-subject="true"]',  // Attribut spécifique
      '.aHl h2'               // Dans le conteneur aHl
    ],
    senderSelectors: [
      '.gD',                   // ✅ Principal - prend le texte directement
      'span.gD',               // ✅ Plus spécifique
      '.gD span',              // Alternative - si texte dans un span enfant
      'span[email]',           // Avec attribut email
      'h3.iw .gD'              // Avec contexte
    ],
    contentSelectors: [
      '.a3s.aiL',              // ✅ Principal
      '.a3s',                  // ✅ Alternative
      'div.a3s',               // Spécifique
      '.ii.gt .a3s',           // Avec contexte
      '[id=":1y"]'             // Avec ID
    ],
    attachmentSelectors: [
      '.aXK',                  // ✅ Principal (conteneur pièce jointe)
      '.aXK.N5jrZb',           // ✅ Plus spécifique
      'div.aXK',               // Alternative
      '.aXK span.aXL',         // Avec le nom
      '[download_url]'         // Avec attribut
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

// Configuration LM Studio
const LM_STUDIO_CONFIG = {
  URL: 'http://127.0.0.1:1234/v1/chat/completions',
  MODEL: 'meta-llama-3-8b-instruct',
  TIMEOUT: 30000 // 30 secondes
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
        logDetail('✅ Trouvé avec sélecteur:', selector);
        return element;
      }
    } catch (e) {
      // Continuer avec le prochain sélecteur
    }
  }
  return null;
}

/**
 * Logging uniquement en vue détail
 */
function logDetail(...args) {
  if (isDetailViewOpen) {
    console.log(...args);
  }
}

/**
 * Vérifie si on est dans la vue détail d'un email
 */
function isEmailDetailViewOpen(service) {
  const config = CONFIG[service];
  const detailElement = document.querySelector(config.detailViewSelector);
  
  if (!detailElement) {
    return false;
  }
  
  return true;
}

/**
 * Récupère le conteneur principal de l'email
 */
function getEmailContainer(service) {
  const config = CONFIG[service];
  const container = document.querySelector(config.emailContainerSelector);
  
  if (!container) {
    logDetail('⚠️ Conteneur email non trouvé:', config.emailContainerSelector);
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
 * Crée un timestamp au moment de l'appel
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Formate le timestamp pour l'affichage
 */
function formatTimestamp(isoString) {
  try {
    return new Date(isoString).toLocaleString('fr-FR');
  } catch (e) {
    return 'Date invalide';
  }
}

/**
 * Analyse l'email pour détecter le phishing via LM Studio
 */
async function analyzeEmailForPhishing(emailData) {
  try {
    logDetail('🔐 Analyse phishing lancée via LM Studio...');
    
    // Préparer les données pour l'IA
    const emailSummary = `
Subject: ${emailData.subject}
Sender: ${emailData.sender}
Service: ${emailData.service}
Attachments: ${emailData.attachmentCount > 0 ? emailData.attachments.map(a => a.name).join(', ') : 'Aucun'}
Content Preview: ${emailData.content.substring(0, 300)}...
    `.trim();

    // Construire le prompt pour l'IA
    const systemPrompt = "Tu es expert cybersécurité. Voici les données provenant d'un mail. Base-toi sur ces données pour me fournir une analyse rapide de la fiabilité du mail. Tu dois détecter une tentative de phishing potentielle. Termine ta réponse par un niveau d'alerte compris entre 0 et 10.";
    
    const userPrompt = `Analyse ce mail pour détecter du phishing:\n\n${emailSummary}`;

    // Envoyer la requête à LM Studio
    const response = await fetch(LM_STUDIO_CONFIG.URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: LM_STUDIO_CONFIG.MODEL,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      logDetail('⚠️ LM Studio non disponible:', response.status);
      return null;
    }

    const data = await response.json();
    const analysis = data.choices[0].message.content;

    logDetail('✅ Analyse IA reçue');
    logDetail(analysis);

    return analysis;

  } catch (error) {
    logDetail('⚠️ Erreur lors de l\'analyse IA:', error.message);
    return null;
  }
}

/**
 * Extrait le niveau d'alerte de la réponse IA
 */
function extractAlertLevel(analysis) {
  try {
    // Chercher un nombre entre 0 et 10
    const match = analysis.match(/(\d+)\s*\/\s*10|niveau.*?(\d+)|alerte.*?(\d+)/gi);
    if (match) {
      const numbers = analysis.match(/\d+/g);
      for (const num of numbers) {
        const n = parseInt(num);
        if (n >= 0 && n <= 10) {
          return n;
        }
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Affiche les informations dans une boîte en bas de la page
 */
function displayEmailInfoInPage(emailData, phishingAnalysis = null) {
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
    width: 450px;
    max-height: 70vh;
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

  // Contenu de l'analyse IA
  let analysisHTML = '';
  if (phishingAnalysis) {
    const alertLevel = extractAlertLevel(phishingAnalysis);
    const alertColor = alertLevel >= 7 ? '#ff6b6b' : alertLevel >= 4 ? '#ffd93d' : '#51cf66';
    
    analysisHTML = `
      <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid ${alertColor};">
        <span style="opacity: 0.8; font-size: 12px; display: block; margin-bottom: 8px;">🤖 ANALYSE IA - DÉTECTION PHISHING</span>
        <div style="font-size: 12px; max-height: 150px; overflow-y: auto; word-break: break-word; line-height: 1.4; margin-bottom: 10px;">
          ${escapeHtml(phishingAnalysis)}
        </div>
        ${alertLevel !== null ? `
          <div style="background: ${alertColor}; padding: 8px; border-radius: 4px; text-align: center; font-weight: 600;">
            ⚠️ Niveau d'alerte: ${alertLevel}/10
          </div>
        ` : ''}
      </div>
    `;
  } else {
    analysisHTML = `
      <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 4px; margin-bottom: 12px;">
        <span style="opacity: 0.8; font-size: 12px; display: block; margin-bottom: 8px;">🤖 ANALYSE IA - DÉTECTION PHISHING</span>
        <div style="font-size: 12px; opacity: 0.9;">⏳ Analyse en cours...</div>
      </div>
    `;
  }

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
        <div style="font-weight: 600; margin-top: 3px; font-size: 12px;">${formatTimestamp(emailData.timestamp)}</div>
      </div>
    </div>

    <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 4px; margin-bottom: 12px;">
      <span style="opacity: 0.8; font-size: 12px; display: block; margin-bottom: 8px;">CONTENU</span>
      <div style="font-size: 13px; max-height: 100px; overflow-y: auto; word-break: break-word; line-height: 1.4;">
        ${escapeHtml(emailData.content.substring(0, 300))}${emailData.content.length > 300 ? '...' : ''}
      </div>
    </div>

    <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 4px; margin-bottom: 12px;">
      <span style="opacity: 0.8; font-size: 12px; display: block; margin-bottom: 8px;">PIÈCES JOINTES (${emailData.attachmentCount})</span>
      ${attachmentsHTML}
    </div>

    ${analysisHTML}
  `;

  // Ajouter la boîte au DOM
  document.body.appendChild(box);

  // Bouton de fermeture
  document.getElementById('close-email-box').addEventListener('click', () => {
    box.remove();
  });
}

/**
 * Met à jour la boîte avec l'analyse IA
 */
function updateEmailBoxWithAnalysis(phishingAnalysis) {
  const box = document.getElementById('email-monitor-box');
  if (!box) return;

  // Trouver et remplacer la section analyse
  const analysisSection = box.querySelector('[style*="ANALYSE IA"]')?.parentElement;
  if (!analysisSection) return;

  const alertLevel = extractAlertLevel(phishingAnalysis);
  const alertColor = alertLevel >= 7 ? '#ff6b6b' : alertLevel >= 4 ? '#ffd93d' : '#51cf66';

  analysisSection.innerHTML = `
    <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 4px; margin-bottom: 12px; border-left: 3px solid ${alertColor};">
      <span style="opacity: 0.8; font-size: 12px; display: block; margin-bottom: 8px;">🤖 ANALYSE IA - DÉTECTION PHISHING</span>
      <div style="font-size: 12px; max-height: 150px; overflow-y: auto; word-break: break-word; line-height: 1.4; margin-bottom: 10px;">
        ${escapeHtml(phishingAnalysis)}
      </div>
      ${alertLevel !== null ? `
        <div style="background: ${alertColor}; padding: 8px; border-radius: 4px; text-align: center; font-weight: 600;">
          ⚠️ Niveau d'alerte: ${alertLevel}/10
        </div>
      ` : ''}
    </div>
  `;
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

    logDetail('🔎 Extraction depuis le conteneur Gmail');
    logDetail('📦 Conteneur:', container);
    
    // Sujet - essayer plusieurs sélecteurs
    const subjectElement = findElementWithMultipleSelectors(container, config.subjectSelectors);
    const subject = subjectElement?.innerText?.trim() || 'Sujet inconnu';
    logDetail('📌 Sujet trouvé:', subject);

    // Expéditeur - essayer plusieurs sélecteurs
    const senderElement = findElementWithMultipleSelectors(container, config.senderSelectors);
    const sender = senderElement?.innerText?.trim() || 'Expéditeur inconnu';
    logDetail('👤 Expéditeur trouvé:', sender);

    // Contenu du mail - essayer plusieurs sélecteurs
    const contentElement = findElementWithMultipleSelectors(container, config.contentSelectors);
    const content = contentElement?.innerText?.trim() || 'Contenu non disponible';
    logDetail('📝 Contenu trouvé (longueur):', content.length);

    // Pièces jointes - essayer plusieurs sélecteurs
    let attachmentElements = [];
    for (const selector of config.attachmentSelectors) {
      try {
        attachmentElements = Array.from(container.querySelectorAll(selector));
        if (attachmentElements.length > 0) {
          logDetail('✅ Pièces jointes trouvées avec:', selector);
          break;
        }
      } catch (e) {
        // Continuer
      }
    }

    const attachments = attachmentElements.map(el => {
      // Récupérer le nom de la pièce jointe
      const nameElement = el.querySelector('.aXL');
      const name = nameElement?.innerText?.trim() || el.getAttribute('download') || 'Fichier inconnu';
      
      // Récupérer la taille (si disponible)
      const size = 'Taille inconnue';
      
      return {
        name: name,
        size: size
      };
    });

    logDetail('📎 Nombre de pièces jointes:', attachments.length);

    // Créer le timestamp AU MOMENT DE L'EXTRACTION
    const timestamp = getTimestamp();
    logDetail('⏰ Timestamp créé:', timestamp);

    return {
      service: 'Gmail',
      subject,
      sender,
      content,
      attachments,
      attachmentCount: attachments.length,
      timestamp: timestamp
    };
  } catch (error) {
    logDetail('❌ Erreur extraction Gmail:', error);
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

    logDetail('🔎 Extraction depuis le conteneur Outlook');
    
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

    // Créer le timestamp AU MOMENT DE L'EXTRACTION
    const timestamp = getTimestamp();

    return {
      service: 'Outlook',
      subject,
      sender,
      content,
      attachments,
      attachmentCount: attachments.length,
      timestamp: timestamp
    };
  } catch (error) {
    logDetail('❌ Erreur extraction Outlook:', error);
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
    logDetail(`⏳ Email pas encore chargé (${service})... tentative ${retries + 1}/${config.maxRetries}`);
    await new Promise(resolve => setTimeout(resolve, config.retryDelay));
    return waitForEmailToLoad(service, retries + 1);
  }

  if (!container) {
    logDetail('⚠️ Impossible de charger le mail après plusieurs tentatives');
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
    logDetail(`⏳ Sujet pas encore disponible (${service})... tentative ${retries + 1}/${config.maxRetries}`);
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
    const isDetail = isEmailDetailViewOpen(service);
    if (!isDetail) {
      isDetailViewOpen = false;
      return;
    }

    // On est en vue détail
    isDetailViewOpen = true;
    console.clear(); // Vider la console
    logDetail('🔍 Nouveau mail détecté (' + service + ')...');
    
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
      logDetail('⏭️  Même email déjà traité, pas de re-extraction:', emailData.subject);
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
    logDetail('✅ EMAIL EXTRAIT AVEC SUCCÈS');
    logDetail('═'.repeat(60));
    logDetail(JSON.stringify(emailData, null, 2));
    logDetail('═'.repeat(60));

    // Afficher le résultat DANS LA PAGE (sans analyse pour le moment)
    displayEmailInfoInPage(emailData);

    // Envoyer au background script
    chrome.runtime.sendMessage({
      type: 'EMAIL_EXTRACTED',
      data: emailData
    }).catch(() => {
      // Le background script n'est pas disponible, c'est OK
    });

    // Lancer l'analyse IA en arrière-plan (async)
    logDetail('🔐 Lancement de l\'analyse IA...');
    analyzeEmailForPhishing(emailData).then(analysis => {
      if (analysis) {
        logDetail('✅ Analyse IA complétée');
        logDetail(analysis);
        updateEmailBoxWithAnalysis(analysis);
      } else {
        logDetail('⚠️ Analyse IA non disponible');
      }
    });

  } catch (error) {
    logDetail('❌ Erreur lors du traitement du mail:', error);
  }
}

/**
 * Monitore les changements avec intervalle (évite les warnings)
 * UNIQUEMENT active en vue détail
 */
function initializeEmailMonitor() {
  const emailService = detectEmailService();
  
  if (!emailService) {
    logDetail('⚠️ Service email non détecté');
    return;
  }

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
      isDetailViewOpen = true;
      console.clear();
      logDetail('👁️  Entrée en vue détail - activation du traitement');
      processEmail(emailService);
    }
    
    // Si on est en vue détail, vérifier les changements d'email
    if (isDetailNow) {
      processEmail(emailService);
    }
    
    // Si on sort de la vue détail, réinitialiser
    if (!isDetailNow && lastDetailViewState) {
      isDetailViewOpen = false;
      logDetail('👈 Retour à la liste - pause du traitement');
      currentEmailId = null;
    }
    
    lastDetailViewState = isDetailNow;
  }, 300);
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
