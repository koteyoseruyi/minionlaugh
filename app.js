(() => {
  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#preview');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const stage = $('#drop-zone');
  const input = $('#gif-file');
  const hexInput = $('#hex-input');
  const colorPicker = $('#color-picker');
  const toleranceInput = $('#tolerance');
  const colorPlane = $('#color-plane');
  const hueSlider = $('#hue-slider');
  const planeCursor = $('#plane-cursor');
  const downloadButton = $('#download-button');
  const status = $('#status');

  let sourceFrames = [];
  let coloredFrames = [];
  let currentFrame = 0;
  let sourceHue = 48;
  let selectedColor = '#F6C945';
  let loopCount = 0;
  let isPlaying = true;
  let isSampling = false;
  let isDemoGif = false;
  let pickerHue = 45;
  let pickerSaturation = 0.72;
  let pickerValue = 0.96;
  let planeDragging = false;
  let timer = 0;
  let renderVersion = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 0));

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let h = 0;
    if (delta) {
      if (max === r) h = 60 * (((g - b) / delta) % 6);
      else if (max === g) h = 60 * ((b - r) / delta + 2);
      else h = 60 * ((r - g) / delta + 4);
    }
    if (h < 0) h += 360;
    return [h, max ? delta / max : 0, max];
  }

  function hexToRgb(hex) {
    const normalized = hex.replace(/^#/, '');
    const full = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized;
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  }

  function rgbToHex(rgb) {
    return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }

  function hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map((channel) => Math.round((channel + m) * 255));
  }

  function hueDistance(a, b) {
    const difference = Math.abs(a - b) % 360;
    return Math.min(difference, 360 - difference);
  }

  function averageMinionHue(frame) {
    const { width, height, pixels } = frame;
    let sin = 0, cos = 0, weight = 0;
    const left = Math.floor(width * 0.30), right = Math.ceil(width * 0.80);
    const top = Math.floor(height * 0.06), bottom = Math.ceil(height * 0.88);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const p = (y * width + x) * 4;
        if (pixels[p + 3] < 100) continue;
        const [h, s, v] = rgbToHsv(pixels[p], pixels[p + 1], pixels[p + 2]);
        if (s < 0.24 || v < 0.20 || h < 12 || h > 90) continue;
        const w = s * Math.min(1, v + 0.2);
        sin += Math.sin(h * Math.PI / 180) * w;
        cos += Math.cos(h * Math.PI / 180) * w;
        weight += w;
      }
    }
    if (!weight) return 48;
    return (Math.atan2(sin, cos) * 180 / Math.PI + 360) % 360;
  }

  function recolorFrame(frame, target, tolerance) {
    const source = frame.pixels;
    const output = new Uint8ClampedArray(source.length);
    const [targetH, targetS] = rgbToHsv(...target);
    const { width, height } = frame;
    for (let p = 0, pixel = 0; p < source.length; p += 4, pixel += 1) {
      const r = source[p], g = source[p + 1], b = source[p + 2], a = source[p + 3];
      output[p + 3] = a;
      if (a < 100) continue;
      const x = pixel % width, y = Math.floor(pixel / width);
      const [h, s, v] = rgbToHsv(r, g, b);
      const distance = hueDistance(h, sourceHue);
      // The sample GIF has a warm decorative ring in its upper-left corner.
      // This small exclusion keeps the background accent intact in the demo.
      const demoRing = isDemoGif && x < width * 0.16 && y < height * 0.50;
      const isWarm = s > 0.13 && v > 0.16 && distance < tolerance && !demoRing;
      if (!isWarm) {
        output[p] = r; output[p + 1] = g; output[p + 2] = b;
        continue;
      }
      const edge = clamp((tolerance - distance) / 7, 0, 1);
      const [tr, tg, tb] = hsvToRgb(targetH, targetS, v);
      output[p] = Math.round(r + (tr - r) * edge);
      output[p + 1] = Math.round(g + (tg - g) * edge);
      output[p + 2] = Math.round(b + (tb - b) * edge);
    }
    return output;
  }

  async function refreshColors() {
    if (!sourceFrames.length) return;
    const version = ++renderVersion;
    downloadButton.disabled = true;
    setStatus('Updating preview…');
    const target = hexToRgb(selectedColor);
    const tolerance = Number(toleranceInput.value);
    const next = [];
    for (let i = 0; i < sourceFrames.length; i += 1) {
      if (version !== renderVersion) return;
      const frame = sourceFrames[i];
      next.push({ ...frame, pixels: recolorFrame(frame, target, tolerance) });
      if (i % 8 === 7) await waitForPaint();
    }
    if (version !== renderVersion) return;
    coloredFrames = next;
    currentFrame %= coloredFrames.length;
    drawFrame(currentFrame);
    downloadButton.disabled = false;
    setStatus(`Ready · ${sourceFrames.length} frames · ${formatDuration(sourceFrames)}`);
    if (isPlaying) scheduleNextFrame();
  }

  function formatDuration(frames) {
    const seconds = frames.reduce((sum, frame) => sum + (frame.delay || 10) * 10, 0) / 1000;
    return `${seconds.toFixed(1)}s`;
  }

  function drawFrame(index) {
    const frame = coloredFrames[index];
    if (!frame) return;
    canvas.width = frame.width;
    canvas.height = frame.height;
    ctx.putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0);
    currentFrame = index;
  }

  function scheduleNextFrame() {
    clearTimeout(timer);
    if (!isPlaying || !coloredFrames.length) return;
    const delay = Math.max(20, (coloredFrames[currentFrame].delay || 10) * 10);
    timer = setTimeout(() => {
      const next = (currentFrame + 1) % coloredFrames.length;
      drawFrame(next);
      scheduleNextFrame();
    }, delay);
  }

  function backgroundColor(bytes) {
    const packed = bytes[10];
    if (!(packed & 0x80)) return { index: bytes[11], rgba: [0, 0, 0, 0] };
    const count = 2 << (packed & 7);
    const index = bytes[11];
    const offset = 13 + index * 3;
    if (index >= count || offset + 2 >= bytes.length) return { index, rgba: [0, 0, 0, 0] };
    return { index, rgba: [bytes[offset], bytes[offset + 1], bytes[offset + 2], 255] };
  }

  function fillRect(pixels, width, rect, rgba) {
    const left = Math.max(0, rect.x), top = Math.max(0, rect.y);
    const right = Math.min(width, rect.x + rect.width), bottom = Math.min(Math.ceil(pixels.length / 4 / width), rect.y + rect.height);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const p = (y * width + x) * 4;
        pixels[p] = rgba[0]; pixels[p + 1] = rgba[1]; pixels[p + 2] = rgba[2]; pixels[p + 3] = rgba[3];
      }
    }
  }

  function decodeGif(bytes) {
    if (typeof GifReader !== 'function') throw new Error('The GIF engine could not load. Please refresh while connected to the internet.');
    const reader = new GifReader(bytes);
    const width = reader.width, height = reader.height, count = reader.numFrames();
    if (!width || !height || !count) throw new Error('This GIF does not contain readable frames.');
    if (width > 1200 || height > 1200 || count > 240 || width * height * count > 8000000) {
      throw new Error('This GIF is too large to process in this browser. Try one under 240 frames and 8 million total pixels.');
    }
    const bg = backgroundColor(bytes);
    let screen = new Uint8ClampedArray(width * height * 4);
    if (bg.rgba[3]) {
      for (let p = 0; p < screen.length; p += 4) {
        screen[p] = bg.rgba[0]; screen[p + 1] = bg.rgba[1]; screen[p + 2] = bg.rgba[2]; screen[p + 3] = 255;
      }
    }
    let previous = null, previousRestore = null;
    const decoded = [];
    for (let i = 0; i < count; i += 1) {
      if (previous) {
        if (previous.disposal === 2) {
          const clear = previous.transparent_index === bg.index ? [0, 0, 0, 0] : bg.rgba;
          fillRect(screen, width, previous, clear);
        } else if (previous.disposal === 3 && previousRestore) {
          screen.set(previousRestore);
        }
      }
      const info = reader.frameInfo(i);
      const restore = info.disposal === 3 ? screen.slice() : null;
      reader.decodeAndBlitFrameRGBA(i, screen);
      decoded.push({ width, height, delay: info.delay, pixels: screen.slice() });
      previous = info;
      previousRestore = restore;
    }
    return { frames: decoded, loopCount: reader.loopCount() };
  }

  async function loadGif(buffer, name) {
    clearTimeout(timer);
    downloadButton.disabled = true;
    $('#play-toggle').disabled = true;
    $('#sample-toggle').disabled = true;
    $('#frame-badge').textContent = 'Reading GIF…';
    setStatus('Reading animation…');
    await waitForPaint();
    try {
      const result = decodeGif(new Uint8Array(buffer));
      sourceFrames = result.frames;
      loopCount = result.loopCount;
      isDemoGif = name === 'Minion laugh · demo GIF';
      currentFrame = 0;
      sourceHue = averageMinionHue(sourceFrames[0]);
      canvas.width = sourceFrames[0].width;
      canvas.height = sourceFrames[0].height;
      $('#file-name').textContent = name;
      $('#frame-badge').textContent = `${sourceFrames.length} FRAMES`;
      $('#empty-state').hidden = true;
      canvas.hidden = false;
      $('#play-toggle').disabled = false;
      $('#sample-toggle').disabled = false;
      isPlaying = true;
      $('#play-toggle').setAttribute('aria-pressed', 'false');
      $('#play-icon').textContent = 'Ⅱ';
      $('#play-label').textContent = 'Pause preview';
      await refreshColors();
    } catch (error) {
      sourceFrames = [];
      coloredFrames = [];
      $('#frame-badge').textContent = 'GIF not loaded';
      $('#empty-state').hidden = false;
      setStatus(error.message || 'Could not read this GIF.', true);
    }
  }

  function makePalette() {
    const palette = new Array(256).fill(0);
    // Reserve index zero for transparency and use a compact 6x8x5 color cube.
    for (let r = 0; r < 6; r += 1) {
      for (let g = 0; g < 8; g += 1) {
        for (let b = 0; b < 5; b += 1) {
          const index = 1 + r * 40 + g * 5 + b;
          const red = Math.round(r * 255 / 5), green = Math.round(g * 255 / 7), blue = Math.round(b * 255 / 4);
          palette[index] = (red << 16) | (green << 8) | blue;
        }
      }
    }
    return palette;
  }

  async function exportGif() {
    if (!coloredFrames.length || typeof GifWriter !== 'function') return;
    downloadButton.disabled = true;
    setStatus('Building your GIF…');
    await waitForPaint();
    try {
      const { width, height } = coloredFrames[0];
      const capacity = width * height * coloredFrames.length * 2 + coloredFrames.length * 2048 + 65536;
      const output = new Uint8Array(capacity);
      const options = { palette: makePalette() };
      if (loopCount !== null) options.loop = loopCount;
      const writer = new GifWriter(output, width, height, options);
      for (let i = 0; i < coloredFrames.length; i += 1) {
        const frame = coloredFrames[i];
        const indexed = new Uint8Array(width * height);
        for (let p = 0, q = 0; p < frame.pixels.length; p += 4, q += 1) {
          if (frame.pixels[p + 3] < 100) { indexed[q] = 0; continue; }
          const r = Math.round(frame.pixels[p] * 5 / 255);
          const g = Math.round(frame.pixels[p + 1] * 7 / 255);
          const b = Math.round(frame.pixels[p + 2] * 4 / 255);
          indexed[q] = 1 + r * 40 + g * 5 + b;
        }
        writer.addFrame(0, 0, width, height, indexed, {
          delay: frame.delay,
          disposal: 2,
          transparent: 0
        });
        if (i % 12 === 11) {
          setStatus(`Building your GIF… ${i + 1}/${coloredFrames.length}`);
          await waitForPaint();
        }
      }
      const length = writer.end();
      const blob = new Blob([output.slice(0, length)], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `minionlaugh-${selectedColor.slice(1).toLowerCase()}.gif`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Downloaded · ${coloredFrames.length} frames · ${formatDuration(coloredFrames)}`);
    } catch (error) {
      setStatus(error.message || 'Could not build this GIF. Try a smaller animation.', true);
    } finally {
      downloadButton.disabled = false;
    }
  }

  function setColor(color, fromText = false, deferRefresh = false) {
    const raw = color.replace(/^#/, '').toUpperCase();
    const normalized = raw.length === 3 ? raw.split('').map((character) => character + character).join('') : raw;
    selectedColor = `#${normalized}`;
    if (!fromText) hexInput.value = selectedColor;
    colorPicker.value = selectedColor;
    syncPrecisionPicker();
    $('#color-error').textContent = '';
    document.querySelectorAll('.swatch').forEach((swatch) => {
      swatch.classList.toggle('selected', swatch.dataset.color.toUpperCase() === selectedColor);
    });
    if (deferRefresh) queueColorRefresh();
    else refreshColors();
  }

  function syncPrecisionPicker() {
    [pickerHue, pickerSaturation, pickerValue] = rgbToHsv(...hexToRgb(selectedColor));
    const hue = Math.round(pickerHue) % 360;
    hueSlider.value = String(hue);
    $('#hue-value').textContent = `${hue}°`;
    colorPlane.style.setProperty('--plane-hue', `hsl(${hue} 100% 50%)`);
    planeCursor.style.left = `${pickerSaturation * 100}%`;
    planeCursor.style.top = `${(1 - pickerValue) * 100}%`;
    colorPlane.setAttribute('aria-valuenow', String(Math.round(pickerSaturation * 100)));
    colorPlane.setAttribute('aria-valuetext', `${Math.round(pickerSaturation * 100)} percent saturation, ${Math.round(pickerValue * 100)} percent brightness`);
  }

  function queueColorRefresh() {
    clearTimeout(window.colorDebounce);
    window.colorDebounce = setTimeout(refreshColors, 45);
  }

  function updateFromPlanePointer(event) {
    const rect = colorPlane.getBoundingClientRect();
    pickerSaturation = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    pickerValue = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1);
    setColor(rgbToHex(hsvToRgb(pickerHue, pickerSaturation, pickerValue)), false, true);
  }

  colorPlane.addEventListener('pointerdown', (event) => {
    planeDragging = true;
    colorPlane.setPointerCapture(event.pointerId);
    updateFromPlanePointer(event);
    event.preventDefault();
  });
  colorPlane.addEventListener('pointermove', (event) => {
    if (planeDragging) updateFromPlanePointer(event);
  });
  colorPlane.addEventListener('pointerup', () => { planeDragging = false; });
  colorPlane.addEventListener('pointercancel', () => { planeDragging = false; });
  colorPlane.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.08 : 0.02;
    if (event.key === 'ArrowLeft') pickerSaturation = clamp(pickerSaturation - step, 0, 1);
    else if (event.key === 'ArrowRight') pickerSaturation = clamp(pickerSaturation + step, 0, 1);
    else if (event.key === 'ArrowUp') pickerValue = clamp(pickerValue + step, 0, 1);
    else if (event.key === 'ArrowDown') pickerValue = clamp(pickerValue - step, 0, 1);
    else return;
    event.preventDefault();
    setColor(rgbToHex(hsvToRgb(pickerHue, pickerSaturation, pickerValue)), false, true);
  });
  hueSlider.addEventListener('input', () => {
    pickerHue = Number(hueSlider.value);
    $('#hue-value').textContent = `${pickerHue}°`;
    colorPlane.style.setProperty('--plane-hue', `hsl(${pickerHue} 100% 50%)`);
    setColor(rgbToHex(hsvToRgb(pickerHue, pickerSaturation, pickerValue)), false, true);
  });

  document.querySelectorAll('.swatch').forEach((swatch) => {
    swatch.style.setProperty('--swatch', swatch.dataset.color);
    swatch.addEventListener('click', () => setColor(swatch.dataset.color));
  });
  colorPicker.addEventListener('input', () => setColor(colorPicker.value));
  hexInput.addEventListener('input', () => {
    const value = hexInput.value.trim();
    if (/^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) setColor(value, true);
    else $('#color-error').textContent = 'Enter a 3- or 6-digit hex color.';
  });
  hexInput.addEventListener('blur', () => {
    if (!/^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexInput.value.trim())) hexInput.value = selectedColor;
  });
  toleranceInput.addEventListener('input', () => {
    $('#tolerance-value').textContent = toleranceInput.value;
    clearTimeout(window.colorDebounce);
    window.colorDebounce = setTimeout(refreshColors, 60);
  });
  downloadButton.addEventListener('click', exportGif);

  $('#play-toggle').addEventListener('click', () => {
    isPlaying = !isPlaying;
    $('#play-toggle').setAttribute('aria-pressed', String(!isPlaying));
    $('#play-icon').textContent = isPlaying ? 'Ⅱ' : '▶';
    $('#play-label').textContent = isPlaying ? 'Pause preview' : 'Play preview';
    if (isPlaying) scheduleNextFrame();
    else clearTimeout(timer);
  });

  $('#sample-toggle').addEventListener('click', () => {
    isSampling = !isSampling;
    $('#sample-toggle').classList.toggle('active', isSampling);
    stage.classList.toggle('is-sampling', isSampling);
    $('#sample-toggle').querySelector('span:last-child').textContent = isSampling ? 'Click the Minion' : 'Pick Minion color';
  });

  canvas.addEventListener('click', (event) => {
    if (!isSampling || !sourceFrames.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(Math.floor((event.clientX - rect.left) / rect.width * canvas.width), 0, canvas.width - 1);
    const y = clamp(Math.floor((event.clientY - rect.top) / rect.height * canvas.height), 0, canvas.height - 1);
    const p = (y * canvas.width + x) * 4;
    const pixel = sourceFrames[currentFrame].pixels;
    const [h, s] = rgbToHsv(pixel[p], pixel[p + 1], pixel[p + 2]);
    if (s < 0.12) {
      setStatus('Choose a colorful part of the Minion, such as its body.', true);
    } else {
      sourceHue = h;
      setStatus(`Color sampled · matching shades within ${toleranceInput.value}°`);
      isSampling = false;
      $('#sample-toggle').classList.remove('active');
      stage.classList.remove('is-sampling');
      $('#sample-toggle').querySelector('span:last-child').textContent = 'Pick Minion color';
      refreshColors();
    }
  });

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setStatus('Please choose a GIF smaller than 15 MB.', true);
      return;
    }
    if (!file.type.includes('gif') && !file.name.toLowerCase().endsWith('.gif')) {
      setStatus('Please choose a GIF file.', true);
      return;
    }
    await loadGif(await file.arrayBuffer(), file.name);
    input.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => stage.addEventListener(type, (event) => {
    event.preventDefault(); stage.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((type) => stage.addEventListener(type, (event) => {
    event.preventDefault(); stage.classList.remove('dragging');
  }));
  stage.addEventListener('drop', async (event) => {
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setStatus('Please choose a GIF smaller than 15 MB.', true); return; }
    if (!file.type.includes('gif') && !file.name.toLowerCase().endsWith('.gif')) { setStatus('Please choose a GIF file.', true); return; }
    await loadGif(await file.arrayBuffer(), file.name);
  });

  fetch('assets/minion-demo.gif')
    .then((response) => {
      if (!response.ok) throw new Error('The demo GIF could not be loaded. Choose a GIF file to begin.');
      return response.arrayBuffer();
    })
    .then((buffer) => loadGif(buffer, 'Minion laugh · demo GIF'))
    .catch((error) => {
      $('#frame-badge').textContent = 'READY FOR A GIF';
      $('#empty-state').hidden = false;
      canvas.hidden = true;
      setStatus(error.message, true);
    });
})();
