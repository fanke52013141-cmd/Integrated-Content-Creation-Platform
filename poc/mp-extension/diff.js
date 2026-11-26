/* Browser-only text and DOM diff summary; no third-party dependencies. */
(function (root) {
  function parse(html) {
    const document = new DOMParser().parseFromString(html || "", "text/html");
    return document.body;
  }

  function canonicalNode(node) {
    if (node.nodeType === Node.COMMENT_NODE) return "";
    if (node.nodeType === Node.TEXT_NODE) {
      return "#text(" + (node.textContent || "").replace(/\s+/g, " ").trim() + ")";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const attributes = Array.from(node.attributes)
      .map((attribute) => [attribute.name, attribute.value])
      .sort(([a], [b]) => a.localeCompare(b));
    return (
      "<" + node.tagName.toLowerCase() +
      attributes.map(([name, value]) => " " + name + "=" + JSON.stringify(value)).join("") +
      ">" +
      Array.from(node.childNodes).map(canonicalNode).join("") +
      "</" + node.tagName.toLowerCase() + ">"
    );
  }

  function tagCounts(body) {
    const counts = {};
    body.querySelectorAll("*").forEach((element) => {
      const tag = element.tagName.toLowerCase();
      counts[tag] = (counts[tag] || 0) + 1;
    });
    return counts;
  }

  function tagDelta(before, after) {
    const added = {};
    const removed = {};
    for (const tag of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const delta = (after[tag] || 0) - (before[tag] || 0);
      if (delta > 0) added[tag] = delta;
      if (delta < 0) removed[tag] = -delta;
    }
    return { added, removed };
  }

  function firstDifference(before, after) {
    const limit = Math.min(before.length, after.length);
    let index = 0;
    while (index < limit && before[index] === after[index]) index += 1;
    if (index === before.length && index === after.length) return null;
    const start = Math.max(0, index - 30);
    return {
      index,
      before: before.slice(start, index + 60),
      after: after.slice(start, index + 60)
    };
  }

  function summarize(beforeHtml, afterHtml) {
    const beforeBody = parse(beforeHtml);
    const afterBody = parse(afterHtml);
    const beforeText = beforeBody.textContent || "";
    const afterText = afterBody.textContent || "";
    const beforeTags = tagCounts(beforeBody);
    const afterTags = tagCounts(afterBody);
    const beforeElements = beforeBody.querySelectorAll("*").length;
    const afterElements = afterBody.querySelectorAll("*").length;
    const beforeCanonical = canonicalNode(beforeBody);
    const afterCanonical = canonicalNode(afterBody);
    const tags = tagDelta(beforeTags, afterTags);

    return {
      changed: beforeCanonical !== afterCanonical,
      text: {
        changed: beforeText !== afterText,
        beforeLength: beforeText.length,
        afterLength: afterText.length,
        delta: afterText.length - beforeText.length,
        firstDifference: firstDifference(beforeText, afterText)
      },
      dom: {
        changed: beforeCanonical !== afterCanonical,
        beforeElements,
        afterElements,
        elementDelta: afterElements - beforeElements,
        addedTags: tags.added,
        removedTags: tags.removed
      }
    };
  }

  root.MpDiff = { summarize };
})(globalThis);
