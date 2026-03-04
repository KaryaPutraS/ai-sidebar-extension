// Content script - extracts page context when requested
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXTRACT_CONTENT") {
    const selection = window.getSelection().toString();
    sendResponse({
      title: document.title,
      url: window.location.href,
      selection: selection,
      metaDescription:
        document.querySelector('meta[name="description"]')?.content || "",
    });
  }
});
