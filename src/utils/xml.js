function areXmlsSemanticallyEqual(xmlString1, xmlString2) {

  if (xmlString1 === '' && xmlString2 === '') {
    return true
  }
  
  const parser = new DOMParser()

  const doc1 = parser.parseFromString(xmlString1, 'application/xml')
  const doc2 = parser.parseFromString(xmlString2, 'application/xml')

  // Optional: Check for parse errors
  if (hasParseError(doc1) || hasParseError(doc2)) {
    console.warn('One of the XML strings is invalid.')
    return false
  }

  // Remove whitespace nodes (and comments) to ensure purely semantic comparison
  cleanNode(doc1)
  cleanNode(doc2)

  // isEqualNode handles tag matching, attribute order, and values automatically
  return doc1.isEqualNode(doc2)
}

// Helper: Recursively remove whitespace-only text nodes and comments
function cleanNode(node) {
  for (let n = 0; n < node.childNodes.length; n++) {
    const child = node.childNodes[n]

    if (
      child.nodeType === 8 || // Comment node
      (child.nodeType === 3 && !/\S/.test(child.nodeValue)) // Text node with only whitespace
    ) {
      node.removeChild(child)
      n-- // Adjust index since we removed a child
    } else if (child.nodeType === 1) {
      // Element node
      cleanNode(child)
    }
  }
}

// Helper: Check if DOMParser returned an error document
function hasParseError(doc) {
  return doc.getElementsByTagName('parsererror').length > 0
}

export { areXmlsSemanticallyEqual }
