## 📧 Email Monitor - Extension Chrome

Extension Chrome pour surveiller en temps réel l'ouverture des emails et extraire automatiquement les informations.

### ✨ Fonctionnalités

✅ **Détection automatique** des emails ouverts  
✅ **Extraction intelligente** des informations :
- Sujet du mail
- Expéditeur
- Contenu du mail
- Pièces jointes (liste)

✅ **Détection de nouveaux emails** - Réextrait si un autre mail est ouvert  
✅ **Caching intelligent** - Pas de re-extraction du même mail  
✅ **Stockage persistant** des emails  
✅ **Console.log détaillé** avec formatage JSON  
✅ **Tableau de bord** pour visualiser les données  
✅ **Export JSON** des emails capturés  

### 📦 Installation

1. Clone ou télécharge les fichiers de l'extension
2. Ouvre `chrome://extensions/`
3. Active le **Mode de développement** (coin supérieur droit)
4. Clique sur **Charger l'extension non empaquetée**
5. Sélectionne le dossier de l'extension

### 🎯 Utilisation

1. Ouvre Gmail ou Outlook
2. L'extension démarre automatiquement la surveillance
3. Ouvre un email
4. L'information est automatiquement extraite et loggée en console
5. Clique sur l'icône de l'extension pour voir le tableau de bord

### 🔄 Comportement intelligent

- **Tu ouvres Email A** → ✅ Extraction et console.log
- **Tu restes sur Email A** → ⏭️ Pas de re-extraction
- **Tu ouvres Email B** → ✅ Nouvelle extraction (c'est un nouvel email)
- **Tu reviens à Email A** → ⏭️ Pas de re-extraction (même session)

### 🔍 Console Output

Quand un email est ouvert avec succès, tu verras :

```
✅ EMAIL EXTRAIT AVEC SUCCÈS
════════════════════════════════════════════════════════════
{
  "service": "Gmail",
  "subject": "Sujet du mail",
  "sender": "expediteur@example.com",
  "content": "Contenu du mail...",
  "attachments": [
    {
      "name": "document.pdf",
      "size": "2.5 MB"
    }
  ],
  "attachmentCount": 1,
  "timestamp": "2024-01-15T10:30:45.123Z"
}
════════════════════════════════════════════════════════════
```

### 📊 Structure des données

Chaque email extrait a cette structure :

```javascript
{
  service: "Gmail" | "Outlook",
  subject: string,
  sender: string,
  content: string,
  attachments: Array<{ name: string, size: string }>,
  attachmentCount: number,
  timestamp: ISO 8601 string
}
```

### 💾 Stockage

- **`processedEmails`** : Set des IDs d'emails traités
- **`extractedEmails`** : Array des emails complets extraits

### 🎛️ Tableau de Bord

Le popup affiche :
- 📊 Nombre d'emails capturés et traités
- 📋 Liste des derniers emails avec horaires
- 💾 Bouton d'export en JSON
- 🗑️ Bouton de suppression des données

### ⏳ Délais d'attente

L'extension attend le chargement complet du mail :
- Jusqu'à **10 tentatives** maximum
- **500ms** entre chaque tentative
- **1 seconde** d'attente supplémentaire après détection

### ⚙️ Configuration

Modifie `CONFIG` dans `content.js` pour ajuster les délais :

```javascript
const CONFIG = {
  GMAIL: {
    emailSelector: '[role="main"] [data-message-id]',
    maxRetries: 10,        // Nombre de tentatives
    retryDelay: 500        // Délai en ms entre tentatives
  },
  OUTLOOK: {
    emailSelector: '[role="main"] .itemRow',
    maxRetries: 10,
    retryDelay: 500
  }
};
```

### 🐛 Troubleshooting

**Les emails ne sont pas détectés ?**
- Vérify que tu es sur Gmail ou Outlook
- Ouvre la console DevTools (F12) pour voir les logs
- Réinstalle l'extension

**Les pièces jointes ne s'extraient pas ?**
- C'est normal si tu es sur Gmail Web. Gmail sécurise l'accès aux pièces jointes
- Les noms des fichiers s'extraient correctement
- Les tailles sont souvent disponibles

**L'extension ralentit ?**
- C'est normal au premier chargement (MutationObserver actif)
- Les emails déjà traités ne sont pas re-analysés (caching)

### 📝 Permissions

L'extension demande l'accès à :
- `activeTab` : Accès à l'onglet actif
- `scripting` : Injection de scripts de contenu
- `storage` : Stockage local des données
- `host_permissions` : Gmail, Outlook

### 🚀 Améliorations futures

- [ ] Support de Yahoo Mail, ProtonMail
- [ ] Synchronisation cloud des données
- [ ] Alertes desktop
- [ ] Filtrages par expéditeur
- [ ] Recherche dans les emails capturés

---

**Version** : 1.0.0  
**Licence** : MIT  
**Support** : GitHub Issues