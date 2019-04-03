// NOTE: Using require instead of import here makes the thing where we print program text work better.
const { useVar, useRequestUpdate, useInitialize, useEventEmitter, useEventReceiver, useDynamic, useReducer } = require('./chinook');

function showString(v) {
  const elem = useVar(null);

  useInitialize(() => {
    elem.current = document.createElement('div');
    elem.current.style.cssText = 'border: 1px solid red; color: black; font-size: 24px; padding: 5px; margin-top: 20px';
    elem.current.textContent = '(undefined)';
    document.body.appendChild(elem.current);

    return () => { // cleanup
      document.body.removeChild(elem.current);
    }
  })

  elem.current.textContent = 'showString: ' + ((v === undefined) ? '(undefined)' : v.toString());
}

function animationTime() {
  const requestUpdate = useRequestUpdate();
  const time = useVar();
  const reqId = useVar();

  useInitialize(() => {
    const onFrame = (t) => {
      time.current = 0.001*t;
      reqId.current = requestAnimationFrame(onFrame); // request another
      requestUpdate();
    };

    time.current = 0.001*performance.now();
    reqId.current = requestAnimationFrame(onFrame);

    return () => { // cleanup
      cancelAnimationFrame(reqId.current);
    }
  });

  return time.current;
}

function animationFrameEvts() {
  const requestUpdate = useRequestUpdate();
  const reqId = useVar();
  const [frameEvts, emitFrame] = useEventEmitter();

  useInitialize(() => {
    const onFrame = (t) => {
      emitFrame();
      reqId.current = requestAnimationFrame(onFrame); // request another
      requestUpdate();
    };

    reqId.current = requestAnimationFrame(onFrame);

    return () => { // cleanup
      cancelAnimationFrame(reqId.current);
    }
  });

  return frameEvts;
}

function countEvents(evts) {
  const count = useVar(0);
  const event = useEventReceiver(evts);

  if (event) {
    count.current++;
  }

  return count.current;
}

function mouseClickEvts() {
  const requestUpdate = useRequestUpdate();
  const [clickEvts, emitClick] = useEventEmitter();

  useInitialize(() => {
    const onMouseDown = () => {
      emitClick();
      requestUpdate();
    }
    document.addEventListener('mousedown', onMouseDown);

    return () => { // cleanup
      document.removeEventListener('mousedown', onMouseDown);
    }
  });

  return clickEvts;
}

function mouseDown() {
  const requestUpdate = useRequestUpdate();
  const isDown = useVar(false); // we can't poll down-ness, so we assume it's initially not down

  useInitialize(() => {
    const onMouseDown = () => {
      isDown.current = true;
      requestUpdate();
    }
    const onMouseUp = () => {
      isDown.current = false;
      requestUpdate();
    }

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);

    return () => { // cleanup
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
    }
  });

  return isDown.current;
}

function mousePosition() {
  const requestUpdate = useRequestUpdate();
  const position = useVar({x: 0, y: 0}); // we can't poll position, so start it at origin

  useInitialize(() => {
    const onMouseMove = (e) => {
      position.current = {
        x: e.clientX || e.pageX,
        y: e.clientY || e.pageY,
      };
      requestUpdate();
    }

    document.addEventListener('mousemove', onMouseMove);

    return () => { // cleanup
      document.removeEventListener('mousemove', onMouseMove);
    }
  });

  return position.current;
}

function random(repickEvts) {
  const val = useVar(Math.random());
  const repick = useEventReceiver(repickEvts);

  if (repick) {
    val.current = Math.random();
  }

  return val.current;
}

function audioDriver(generator) {
  const createGenerator = useDynamic(generator);
  const generatorCtx = useVar();
  const frameCount = useVar(0);
  const sampleRate = useVar();
  const [advanceFrameEvts, emitAdvanceFrame] = useEventEmitter();

  useInitialize(() => {
    generatorCtx.current = createGenerator();

    const BUFFER_SIZE = 1024;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const scriptNode = audioContext.createScriptProcessor(BUFFER_SIZE, 0, 1); // 0 input channels, 1 output channel
    scriptNode.onaudioprocess = (e) => {
      const buffer = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < buffer.length; i++) {
        emitAdvanceFrame({});
        buffer[i] = generatorCtx.current.update(frameCount.current/sampleRate.current, advanceFrameEvts, sampleRate.current);
        frameCount.current++;
      }
    };
    scriptNode.connect(audioContext.destination);

    sampleRate.current = audioContext.sampleRate;

    return () => {
      scriptNode.disconnect();
      audioContext.close();
    };
  });

  /**
   * Most of our generator updating will happen in the audio processing callback above.
   * This update here is for when the audioDriver update is called, e.g. when an outer scope
   * reference that the generator depends on has changed. So we must update the generator,
   * but don't need its output amplitude.
   */
  generatorCtx.current.update(frameCount.current/sampleRate.current, advanceFrameEvts, sampleRate.current); // NOTE: we discard retval
}

function sampleUpon(toSample, uponEvts, initialValue) {
  const held = useVar(initialValue);
  const upon = useEventReceiver(uponEvts);

  if (upon) {
    held.current = toSample;
  }

  return held.current;
}

function everySecond() {
  const requestUpdate = useRequestUpdate();
  const [tickEvts, emitTick] = useEventEmitter();

  useInitialize(() => {
    const onInterval = () => {
      emitTick();
      requestUpdate();
    }
    const timerId = setInterval(onInterval, 1000);

    return () => { // cleanup
      clearInterval(timerId);
    }
  });

  return tickEvts;
}

/**
 * Until audio is loaded and decoded, a single-sample buffer of silence is returned.
 */
function loadAudioAsArray(url) {
  const requestUpdate = useRequestUpdate();
  const pcm = useVar([0]); // until loaded, just return single sample of silence

  useInitialize(() => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let cleanedUp = false;

    const request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    request.onload = () => {
      const audioData = request.response;
      audioCtx.decodeAudioData(audioData, buffer => {
        if (!cleanedUp) {
          pcm.current = buffer.getChannelData(0);
          requestUpdate();
        }
      });
    };

    request.send();

    return () => { // cleanup
      request.abort(); // it's safe to always abort here. if already completed, it will be ignored

      // decodeAudioData cannot be canceled. So to be correct, we must set a flag here to make sure
      // that decoding is ignored
      cleanedUp = true;
    }
  });

  return pcm.current;
}

function consoleLog(v) {
  console.log(v);
}

function integral(integrandFunc, time, initialValue = 0) {
  const accum = useVar(initialValue);
  const prevTime = useVar(time);

  const integrand = integrandFunc(accum.current, prevTime.current);
  accum.current += (time - prevTime.current)*integrand;

  prevTime.current = time;

  return accum.current;
}

function smoothFollow(targetValue, time, speedConstant) {
  return integral(currentValue => speedConstant*(targetValue - currentValue), time);
}

function redCircle(position, radius = 25) {
  const elem = useVar(null);

  useInitialize(() => {
    elem.current = document.createElement('div');
    elem.current.style.cssText = 'position: absolute; border-radius: 50%; background: red; pointer-events: none; user-select: none';
    document.body.appendChild(elem.current);

    return () => { // cleanup
      document.body.removeChild(elem.current);
    }
  })

  const p = position || {x: 0, y: 0};
  if (radius < 0) {
    radius = 0;
  }
  const halfRadius = 0.5*radius;

  elem.current.style.left = (p.x - halfRadius) + 'px';
  elem.current.style.top = (p.y - halfRadius) + 'px';
  elem.current.style.width = radius + 'px';
  elem.current.style.height = radius + 'px';
}

export default [
  {
    name: 'do nothing',
    main: () => {
    },
  },

  {
    name: 'animation time',
    main: () => {
      showString(animationTime().toFixed(3));
    },
  },

  {
    name: 'count clicks',
    main: () => {
      showString(countEvents(mouseClickEvts()));
    },
  },

  {
    name: 'is mouse button down',
    main: () => {
      showString(mouseDown());
    },
  },

  {
    name: 'random number, click to repick',
    main: () => {
      showString(random(mouseClickEvts()));
    },
  },

  {
    name: 'audio noise when mouse is down',
    main: () => {
      const md = mouseDown();
      audioDriver((audioTime, advanceFrameEvts) => {
        const noise = random(advanceFrameEvts) - 0.5;
        return md ? noise : 0;
      });
    },
  },

  {
    name: 'decaying noise upon click',
    main: () => {
      const clickEvts = mouseClickEvts();
      audioDriver((audioTime, advanceFrameEvts) => {
        const noise = random(advanceFrameEvts) - 0.5;
        const lastClickTime = sampleUpon(audioTime, clickEvts, -Infinity);
        const decayingGain = Math.exp(5*(lastClickTime - audioTime));
        return decayingGain*noise;
      });
    },
  },

  {
    name: 'resetting frame counter, click to reset',
    main: () => {
      const frameEvts = animationFrameEvts();
      const clickEvts = mouseClickEvts();
      const click = useEventReceiver(clickEvts);
      const createCounter = useDynamic(countEvents);
      const activeCounter = useVar();

      if (click) {
        if (activeCounter.current) {
          activeCounter.current.terminate();
        }
        activeCounter.current = createCounter();
      }
      if (!activeCounter.current) {
        activeCounter.current = createCounter();
      }

      const displayedCount = activeCounter.current.update(frameEvts);
      showString(displayedCount);
    }
  },

  {
    name: 'dynamic array of async clocks, click to add',
    main: () => {
      const clickEvts = mouseClickEvts();
      const click = useEventReceiver(clickEvts);
      const createClock = useDynamic(() => countEvents(everySecond()));
      const clockArray = useVar([]);

      if (click) {
        clockArray.current.push(createClock());
      }

      const nums = clockArray.current.map(clock => clock.update());
      showString(nums.join(' '));
    }
  },

  {
    name: 'record player spin up/down, hold mouse down and release',
    main: () => {
      const pcm = loadAudioAsArray('amen_break.mp3');
      showString(pcm.length > 1 ? 'loaded audio' : 'loading audio...');
      audioDriver((audioTime, advanceFrameEvts, sampleRate) => {
        const targetSpeed = mouseDown() ? sampleRate : 0;
        const speed = smoothFollow(targetSpeed, audioTime, 3);
        const pos = Math.floor(integral(() => speed, audioTime));
        return pcm[pos % pcm.length]; // modulo so as to loop
      });
    }
  },

  {
    name: 'circle follows mouse',
    main: () => {
      redCircle(mousePosition());
    }
  },

  {
    name: 'circle moves halfway to mouse with each click',
    main: () => {
      const midpoint = (a, b) => ({x: 0.5*(a.x+b.x), y: 0.5*(a.y+b.y)});
      const mpos = mousePosition();
      const clickEvts = mouseClickEvts();
      const cpos = useReducer(clickEvts, (action, prevState) => {
        if (action) {
          return midpoint(prevState, mpos);
        } else {
          return prevState;
        }
      }, {x: 0, y: 0});
      redCircle(cpos);
    }
  },
]
