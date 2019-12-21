import { SignatureNode, NodeKind } from './Tree';
import { useCallbackReducer } from 'riv-runtime';
const { showString, animationTime, mouseDown, changeCount, streamMap, audioDriver, random, mouseClickEvts, redCircle, mousePosition, latestValue } = require('riv-demo-lib');
const { h, renderDOMIntoSelector } = require('riv-snabbdom');

interface Vec2d {
  x: number;
  y: number;
}

function vec2dlen(v: Vec2d) {
  return Math.sqrt(v.x*v.x + v.y*v.y);
}

function vec2sqgrid(count: number, size: number) {
  const spacing = size / count;
  const vecs: Array<Vec2d> = [];
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      vecs.push({
        x: x*spacing,
        y: y*spacing,
      });
    }
  }

  return vecs;
}

function simpleSig(pnames: Array<string>, yields: boolean): SignatureNode {
  return {
    kind: NodeKind.Signature,
    streamParams: pnames.map(pn => ({kind: NodeKind.SignatureStreamParameter, name: { kind: NodeKind.Name, text: pn }})),
    funcParams: [],
    yields: yields ? [{kind: NodeKind.SignatureYield}] : [],
  }
}

const nativeFunctions: Array<[string, string, SignatureNode, Function]> = [
  // simple
  ['ifte', 'if', simpleSig(['cond', 'then', 'else'], true), (cond: any, _then: any, _else: any) => (cond ? _then : _else)],

  // events
  ['changeCount', 'change count', simpleSig(['_stream'], true), changeCount],
  ['latestValue', 'latest event value', simpleSig(['event stream', 'initial value'], true), latestValue],

  // math
  ['add', 'add', simpleSig(['_a', '_b'], true), (a: number, b: number) => a + b],
  ['sub', 'subtract', simpleSig(['_a', '_b'], true), (a: number, b: number) => a - b],
  ['mult', 'multiply', simpleSig(['_a', '_b'], true), (a: number, b: number) => a * b],
  ['div', 'divide', simpleSig(['_a', '_b'], true), (a: number, b: number) => a / b],
  ['cos', 'cosine', simpleSig(['_v'], true), Math.cos],

  // dom/browser
  ['showString', 'show value', simpleSig(['_v'], false), showString],
  ['animationTime', 'animation time', simpleSig([], true), animationTime],
  ['mouseDown', 'is mouse down', simpleSig([], true), mouseDown],
  ['mousePosition', 'mouse position', simpleSig([], true), mousePosition],
  ['mouseClickEvts', 'mouse click', simpleSig([], true), mouseClickEvts],
  ['redCircle', 'draw red circle', simpleSig(['position', 'radius'], false), redCircle],
  ['random', 'random', simpleSig(['repick'], true), random],

  // vec2
  ['vec2zero', 'zero 2d vector', simpleSig([], true), () => ({x: 0, y: 0})],
  ['vec2add', 'add 2d vectors', simpleSig(['_a', '_b'], true), (a: Vec2d, b: Vec2d) => ({x: a.x+b.x, y: a.y+b.y})],
  ['vec2sub', 'subtract 2d vectors', simpleSig(['_a', '_b'], true), (a: Vec2d, b: Vec2d) => ({x: a.x-b.x, y: a.y-b.y})],
  ['vec2len', 'length of 2d vector', simpleSig(['_v'], true), vec2dlen],
  ['vec2sqgrid', 'square grid of 2d vectors', simpleSig(['count', 'size'], true), vec2sqgrid],

  // misc
  ['text2num', 'text to number', {
    kind: NodeKind.Signature,
    streamParams: [
      {
        kind: NodeKind.SignatureStreamParameter,
        name: {kind: NodeKind.Name, text: 'text'},
      },
    ],
    funcParams: [],
    yields: [
      {
        kind: NodeKind.SignatureYield,
        name: {kind: NodeKind.Name, text: 'number'},
      },
    ],
  }, (text: string) => Number(text)],

  // snabbdom
  ['snabbdom.renderDOMIntoSelector', 'render elem', simpleSig(['elem', 'selector'], false), renderDOMIntoSelector],
  ['snabbdom.text', 'text', simpleSig(['text'], true), (text: string) => h('span', {}, text)],
  ['snabbdom.div', 'div', simpleSig(['children'], true), (children: ReadonlyArray<any>) => h('div', {}, children)],
  ['snabbdom.input', 'input', {
    kind: NodeKind.Signature,
    streamParams: [
      {
        kind: NodeKind.SignatureStreamParameter,
        name: {kind: NodeKind.Name, text: 'prefill'},
      },
    ],
    funcParams: [],
    yields: [
      {
        kind: NodeKind.SignatureYield,
        name: {kind: NodeKind.Name, text: 'elem'},
      },
      {
        kind: NodeKind.SignatureYield,
        name: {kind: NodeKind.Name, text: 'text'},
      },
    ],
  }, (prefill: string): any => {
    const safePrefill = (typeof prefill === 'string') ? prefill : '';
    const [text, inputHandler] = useCallbackReducer<string, any>((_, e) => {
      const newText = e.target.value;
      return newText;
    }, safePrefill);
    return [
      h('input', {on: {input: inputHandler}, attrs: {value: text}}), // elem
      text // text
    ];
  }],

  // multiple yields
  ['trig', 'trig', {
    kind: NodeKind.Signature,
    streamParams: [
      {
        kind: NodeKind.SignatureStreamParameter,
        name: {kind: NodeKind.Name, text: 'radians'},
      },
    ],
    funcParams: [],
    yields: [
      {
        kind: NodeKind.SignatureYield,
        name: {kind: NodeKind.Name, text: 'sin'},
      },
      {
        kind: NodeKind.SignatureYield,
        name: {kind: NodeKind.Name, text: 'cos'},
      },
      {
        kind: NodeKind.SignatureYield,
        name: {kind: NodeKind.Name, text: 'tan'},
      },
    ],
  }, (v: number) => [Math.sin(v), Math.cos(v), Math.tan(v)]],

  // higher-order
  ['streamMap', 'map', {
    kind: NodeKind.Signature,
    streamParams: [
      {
        kind: NodeKind.SignatureStreamParameter,
        name: {kind: NodeKind.Name, text: 'array'},
      },
    ],
    funcParams: [
      {
        kind: NodeKind.SignatureFunctionParameter,
        name: {kind: NodeKind.Name, text: 'xform one value'},
        sig: {
          kind: NodeKind.Signature,
          streamParams: [
            {
              kind: NodeKind.SignatureStreamParameter,
              name: {kind: NodeKind.Name, text: 'value'},
            }
          ],
          funcParams: [],
          yields: [
            {
              kind: NodeKind.SignatureYield,
            }
          ],
        },
      },
    ],
    yields: [
      {
        kind: NodeKind.SignatureYield,
      },
    ],
  }, (arr: Array<any>, f: (v: any) => any) => streamMap(f, arr)],

  ['audioDriver', 'play computed audio', {
    kind: NodeKind.Signature,
    streamParams: [],
    funcParams: [
      {
        kind: NodeKind.SignatureFunctionParameter,
        name: {kind: NodeKind.Name, text: 'compute one sample'},
        sig: {
          kind: NodeKind.Signature,
          streamParams: [
            {
              kind: NodeKind.SignatureStreamParameter,
              name: {kind: NodeKind.Name, text: 'audio time'},
            },
            {
              kind: NodeKind.SignatureStreamParameter,
              name: {kind: NodeKind.Name, text: 'next frame'},
            },
            {
              kind: NodeKind.SignatureStreamParameter,
              name: {kind: NodeKind.Name, text: 'sample rate'},
            },
          ],
          funcParams: [],
          yields: [
            {
              kind: NodeKind.SignatureYield,
            }
          ],
        },
      },
    ],
    yields: [],
  }, audioDriver],
];

export default nativeFunctions;
