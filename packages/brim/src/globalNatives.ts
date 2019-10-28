import { FunctionSignature } from './Signature';
const { showString, animationTime, mouseDown, changeCount, streamMap, audioDriver, random, mouseClickEvts, redCircle, mousePosition, latestValue } = require('riv-demo-lib');

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

function simpleSig(pnames: Array<string>, yields: boolean): FunctionSignature {
  return {
    streamParameters: pnames.map(pn => ({name: pn})),
    functionParameters: [],
    yields,
  }
}

const nativeFunctions: Array<[string, string, FunctionSignature, Function]> = [
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
  ['showString', 'show value', simpleSig(['_v'], true), showString],
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

  // higher-order
  ['streamMap', 'map', {
    streamParameters: [
      {
        name: 'array',
      },
    ],
    functionParameters: [
      {
        name: 'transform one value',
        signature: {
          streamParameters: [
            {
              name: 'value',
            }
          ],
          functionParameters: [],
          yields: true,
        },
      },
    ],
    yields: true,
  }, (arr: Array<any>, f: (v: any) => any) => streamMap(f, arr)],

  ['audioDriver', 'play computed audio', {
    streamParameters: [],
    functionParameters: [
      {
        name: 'compute one sample',
        signature: {
          streamParameters: [
            {
              name: 'audio time',
            },
            {
              name: 'next frame',
            },
            {
              name: 'sample rate',
            },
          ],
          functionParameters: [],
          yields: true,
        },
      },
    ],
    yields: false,
  }, audioDriver],
];

export default nativeFunctions;
