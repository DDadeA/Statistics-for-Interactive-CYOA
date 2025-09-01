const version = "0.0.1";
let startTime = Date.now();
let initialized = false;

window.onload = () => {
setTimeout(() => {
    if(!initialized) {
        console.warn("Logging not initialized. Call initializeLogging(projectId) to enable logging.");
    }
}, 5000);    
};
  
const sendAnalytics = (eventType, projectId) => {
  const analyticsData = JSON.stringify({
    eventType: eventType,
    version: version,
    projectHash: getProjectHash(),

    selectedChoices: getChoices().filter(c=>c.isActive).map(c=>c.id),
    timeOnPage: Date.now() - startTime,
    timestamp: new Date().toISOString(),
    
    screenResolution: window.screen.width + 'x' + window.screen.height,
      viewportSize: window.innerWidth + 'x' + window.innerHeight,
      referrer: document.referrer || 'direct',

      currentURL: window.location.href,
      userAgent: navigator.userAgent,
  });

  fetch('https://statistics-for-interactive-cyoa.pages.dev/api/log', {
    method: 'POST',
    body: JSON.stringify(
        {
            projectId: projectId,
            data: analyticsData,
        }
    ),
    headers: { 'Content-Type': 'application/json' },
    keepalive: true
  });

};


function initializeLogging(projectId) {
    console.log("Initialize SSSICYOA version " + version);
    console.log("\tTesting functions...");

    let choices = getChoices();
    console.log("\t\tChoices:", choices);

    let projectHash = getProjectHash();
    console.log("\t\tProject Hash:", projectHash);

    window.addEventListener('pagehide', (event) => {
        if (!event.persisted) {
            sendAnalytics('quit', projectId);
        }
    });
    console.log("\tRegistered pagehide event.");

    initialized = true;
}

function hashString(str) {
    let hash = 0, i, chr;
    if (str.length === 0) return hash;
    for (i = 0; i < str.length; i++) {
        chr   = str.charCodeAt(i);
        hash  = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

function getProjectHash() {
    let choices = getChoices();

    const mergedIds = choices.map(c => c.id).join('|');
    const mergedTitles = choices.map(c => c.title).join('|');
    const mergedTexts = choices.map(c => c.text).join('|');
    const mergedRequireds = choices.map(c => c.requireds.toString()).join('|');
    const mergedScores = choices.map(c => JSON.stringify(c.scores)).join('|');

    const dataToHash = mergedIds + '||' + mergedTitles + '||' + mergedTexts + '||' + mergedRequireds + '||' + mergedScores;

    return hashString(dataToHash);
}


function getChoices() {
    let app;
    try {
        // try vue ( ICC, ICC Plus < 2.0 )
        app = document.querySelector('#app').__vue__.$store.state.app;
      } catch (e) {
        // try svelte ( ICC Plus >= 2.0 )
        app = window.debugApp;
      }

      if (!app) {
        console.warn("Could not find app state for logging.");
        return [];
      }

      return app.rows.flatMap(row => row.objects || []);
}
  