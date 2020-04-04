const vscode = require('vscode');

const Viz = require('viz.js');
const { Module, render } = require('viz.js/full.render');
var viz = new Viz({ Module, render });

const { Grammar } = require('pegtree');

const TemplateDot = `\
digraph AST {
graph [
charset = "UTF-8",
label = "$input_text",
labelloc = "t",
fontname = "MS Gothic",
fontcolor = "#252525",
fontsize = "18",
];

edge [
dir = "none",
fontname = "MS Gothic",
fontcolor = "#252525",
fontsize = "12",
];

node [
shape = "box",
style = "rounded,filled",
color = "#3c3c3c",
fillcolor = "#f5f5f5",
fontname = "MS Gothic",
fontsize = "16",
fontcolor = "#252525",
];

$node_description

$edge_description
}`

const TerminalNodeStyle = '';


function escape(s) {
    var after = '';
    const META_LITERAL = ['\\', '"'];
    for (var c of s) {
        if (META_LITERAL.includes(c)){
            after += `\\${c}`;
        } else {
            after += c;
        }
    }
    return after;
}


function mySubs(ast) {
    var es = [];
    if (!'subs_' in ast) { return es; }
    for (var child of ast.subs_) {
        es.push([child.spos_, '', child]);
    }
    for (var [key, v] of Object.entries(ast)) {
        if ((typeof(v) === 'object') && ('tag_' in v) && ('inputs_' in v) && ('spos_' in v) && ('epos_' in v)) {
            es.push([v.spos_, key, v]);
        }
    }
    es.sort((l, r) => {
        if (l[0] > r[0]){
            return 1;
        } else if (l[0] < r[0]) {
            return -1;
        } else {
            return 0;
        }
    });
    return es.map(tpl => [tpl[1], tpl[2]]);
}


function makeDict(t, d, nid) {
    var subs = mySubs(t);
    d.node.push(`n${nid} [label="#${t.tag_}"]`);
    if (subs.length > 0) {
        for (var [i, tpl] of Object.entries(subs)) {
            const label = (tpl[0] != '' ? ` [label="${tpl[0]}"]` : '');
            d.edge.push(`n${nid} -> n${nid}_${i}${label}`);
            makeDict(tpl[1], d, `${nid}_${i}`);
        }
    } else {
        const leaf = t.inputs_.substring(t.spos_, t.epos_);
        d.node.push(`n${nid}_0 [label="${escape(leaf)}", ${TerminalNodeStyle}]`)
        d.edge.push(`n${nid} -> n${nid}_0`)
    }
}


function tree2dot(ast) {
    var d = {
        node: [],
        edge: []
    };
    makeDict(ast, d, 0);
    ctx = {
        input_text: escape(ast.inputs_),
        node_description: d.node.join(';\n'),
        edge_description: d.edge.join(';\n'),
    }
    return TemplateDot.replace('$input_text', ctx.input_text).replace('$node_description', ctx.node_description).replace('$edge_description', ctx.edge_description);
}


async function dot2svg(dot) {
    var svg = '';
    await viz.renderSVGElement(dot).then(element => {
        svg = element;
    }).catch(err => {
        console.log(err);
        vscode.window.showErrorMessage(err);
    });
    return svg;
}


function activate(context) {
    let panel = undefined;
    let existPanel = false;
    let disposable = vscode.commands.registerCommand('extension.genViewer', async function () {
        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn.Beside
            : undefined;
        if (existPanel && panel) {
            panel.reveal(columnToShowIn);
        } else {
            panel = vscode.window.createWebviewPanel(
                'pegtreeviewer', // Identifies the type of the webview. Used internally
                'PEGTree Viewer', // Title of the panel displayed to the user
                vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
                {
                    retainContextWhenHidden: true,
                    enableScripts: true,
                }
            );
            existPanel = true;
            const config = vscode.workspace.getConfiguration();
            console.log(config);
            const cfg = config.get('configurations');
            console.log(cfg);
        }
        const grammar = vscode.window.activeTextEditor.document.getText();
        const peg = new Grammar(grammar);
        const parser = peg.generate();

        panel.webview.html = getWebviewContent(grammar);

        panel.webview.onDidReceiveMessage(async message => {
            const ast = parser(message.text);
            const dot = tree2dot(ast);
            switch (message.command) {
                case 'input':
                    const svg = await dot2svg(dot);
                    panel.webview.postMessage({
                        command: 'graph',
                        text: svg
                    })
                return;
            }
        }, undefined, context.subscriptions);

        panel.onDidDispose(()=>{
            existPanel = false;
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(disposable);
}
exports.activate = activate;


function getWebviewContent() {
    return `
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="ie=edge">
<title>Document</title>
<style>
* {
    box-sizing: border-box;
}

html, body {
    height: 100%;
    width: 100%;
    margin: 0px;
}

h1#title, textarea#input, button#parse, div#tree {
    display: block;
    margin: 10px auto;
    max-width: 90%;
}

h1#title {
    padding-left: 4%;
    border-bottom: solid 5px;
}

textarea#input, button#parse {
    font-size: 120%;
}

textarea#input {
    margin-top: 20px;
    resize: none;
}

div#tree {
    height: 500px;
    overflow: hidden;
    text-align: center;
    margin: auto;
    position: relative;
    background-color: #808588;
}

div#zoom {
    position: absolute;
    display: flex;
    bottom: 5%;
    right: 5%;
}
button.zoom {
    font-size: 150%;
    border-radius: 20%;
    margin: auto 10px;
}

</style>
</head>
<body>
<h1 id="title">PEGTree Viewer</h1>
<textarea id='input' cols='80' rows='3' wrap='soft' placeholder='テキストを入力'></textarea>
<button id="parse">Parse</button>
<div id='tree'></div>

<script>
const vscode = acquireVsCodeApi();

var zeroOfDivTree = [0, 0];

function setDivTreeStyle() {
  var h_body = document.querySelector('body').offsetHeight;
  var h_h1 = document.querySelector('h1#title').offsetHeight;
  var h_textarea = document.querySelector('textarea#input').offsetHeight+10;
  var h_button = document.querySelector('button#parse').offsetHeight;
  var h_div = h_body - (h_h1 + h_textarea + h_button);
  document.querySelector('div#tree').style.height = String(h_div-10*6) + 'px';
  document.querySelector('svg').height.baseVal.valueAsString = String(h_div-10*6) + 'px';
  document.querySelector('svg').width.baseVal.valueAsString = String(document.querySelector('div#tree').offsetWidth) + 'px';
  document.querySelector('svg').viewBox.baseVal.width = document.querySelector('div#tree').offsetWidth;
  document.querySelector('svg').viewBox.baseVal.height = h_div-10*6;
  zeroOfDivTree = [(document.querySelector('body').offsetWidth-document.querySelector('h1#title').offsetWidth)/2 + 10, h_h1+h_textarea+h_button+10*4 - 0];
}


var drag = {
  isMouseDown : false,
  target : null,
  offsetx : 0,
  offsety : 0,
}

function addMouseEvent2Tree() {
var offsetG = document.querySelector('g#graph0.graph').transform.baseVal[0].matrix.f;

document.onmouseup = function () {
  drag.isMouseDown = false;
}

document.onmousemove = function(e) {
  if (drag.isMouseDown == true) {
    var mtrx = drag.target.transform.baseVal[0].matrix;
    mtrx.e = e.clientX-drag.offsetx-zeroOfDivTree[0];
    mtrx.f = e.clientY-drag.offsety-zeroOfDivTree[1]+offsetG;
  }
}

function draggable(element) {
  element.addEventListener('mousedown', function(e) {
    e.preventDefault();
    var svg = element.getBoundingClientRect();
    drag.offsetx = e.clientX - svg.left;
    drag.offsety = e.clientY - svg.top;;
    drag.isMouseDown = true;
    return false;
  });
}

document.querySelector('button#zoom-in').onclick = function() {
    var mtrx = drag.target.transform.baseVal[0].matrix;
    mtrx.a *= 1.2;
    mtrx.d *= 1.2;
    mtrx.f += offsetG*0.2;
    offsetG *= 1.2;
};
document.querySelector('button#zoom-out').onclick = function() {
    var mtrx = drag.target.transform.baseVal[0].matrix;
    mtrx.a *= 0.8;
    mtrx.d *= 0.8;
    mtrx.f -= offsetG*0.2;
    offsetG *= 0.8;
};
setDivTreeStyle();
var g = document.querySelector('g#graph0.graph');
draggable(g);
drag.target = g;
}


window.onload = function() {
  setDivTreeStyle();
}

window.onresize = () => {
  setDivTreeStyle();
};

document.querySelector('button#parse').onclick = function() {
  const txt = document.querySelector('textarea#input').value;
  vscode.postMessage({
    command: 'input',
    text: txt
  });
}

const zoomButtonHTML = \`\
<div id="zoom">
  <button id="zoom-in" class="zoom">+</button>
  <button id="zoom-out" class="zoom">-</button>
</div>
\`

// Handle the message inside the webview
window.addEventListener('message', event => {
  const message = event.data; // The JSON data our extension sent
  switch (message.command) {
    case 'graph':
      document.querySelector('div#tree').innerHTML = zoomButtonHTML + message.text;
      addMouseEvent2Tree();
      break;
  }
});

</script>
</body>
</html>`;
}

