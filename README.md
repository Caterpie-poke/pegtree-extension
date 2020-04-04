# PEGTree Extension

Language Extension Packs for PEGTree.
This extension includes "Syntax Highlight for TPEG" and "Tree Viewer".

<!-- ## Syntax Highlight for TPEG -->

<!-- ## Tree Viewer -->

# Customized Module
Webview of VSCode don't support Web Worker API and DOMParser.
Therefore this extension use `dom-parser` in `viz.js` with modifying as below.

```
/* line 291~ */
const DomParser = require('dom-parser');
var parser = new DomParser();
return parser.parseFromString(str).rawHTML;
```

