// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Listen for messages from content script and sidebar
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PAGE_CONTENT") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript(
          {
            target: { tabId: tabs[0].id },
            func: extractPageContent,
          },
          (results) => {
            if (results && results[0]) {
              sendResponse({ content: results[0].result });
            } else {
              sendResponse({ content: null });
            }
          }
        );
      }
    });
    return true; // Keep message channel open for async response
  }
});

function extractPageContent() {
  const title = document.title;
  const url = window.location.href;
  const selection = window.getSelection().toString();
  const metaDescription =
    document.querySelector('meta[name="description"]')?.content || "";

  // Get main text content, limited to a reasonable size
  const bodyText = document.body.innerText.substring(0, 5000);

  return { title, url, selection, metaDescription, bodyText };
}
