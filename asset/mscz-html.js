// msczHtml.js

if (typeof window === "undefined") {
    throw new Error("This module is intended to be run in a browser environment.");
}

const numberToTime = (number) => {
    const hours = Math.floor(number / 3600);
    const minutes = Math.floor((number % 3600) / 60);
    const seconds = Math.floor(number % 60);
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const bisect_right = (arr, x, lo = 0, hi = arr.length, key = (x) => x) => {
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (key(arr[mid]) <= x) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

// Modified from https://www.w3.org/TR/png/#D-CRCAppendix
let crc_table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc_table[n] = c >>> 0;
}
/**
 * Updates the CRC value with the given buffer.
 * @param {Uint8Array} buf - The data buffer to update the CRC with.
 * @param {Uint32Array} crc - The initial CRC value (default: 0xffffffff).
 * 
 * @returns {Uint32Array} The updated CRC value.
 */
const crc32 = (buf, crc = new Uint32Array([0xffffffff])) => {
    let c = new Uint32Array([crc[0]]);
    for (let n = 0; n < buf.length; n++) {
        c[0] = crc_table[(c[0] ^ buf[n]) & 0xff] ^ (c[0] >>> 8);
    }
    return new Uint32Array([c[0] ^ 0xffffffff]);
}

/**
 * Gets the DPI (dots per inch) of a PNG image.
 * @function get_png_dpi
 * @param {ArrayBuffer} png - The PNG image data as an ArrayBuffer.
 * 
 * @returns {number[]} An array containing the X DPI and Y DPI of the PNG image.
 * @throws {Error} Throws an error if the PNG data is invalid or if the DPI cannot be determined.
 */
const get_png_dpi = (png) => {
    const pngHeader = new Uint8Array(png, 0, 8);
    if (pngHeader[0] !== 0x89 || pngHeader[1] !== 0x50 || pngHeader[2] !== 0x4E || pngHeader[3] !== 0x47 ||
        pngHeader[4] !== 0x0D || pngHeader[5] !== 0x0A || pngHeader[6] !== 0x1A || pngHeader[7] !== 0x0A) {
        throw new Error("Invalid PNG data");
    }
    const pngData = new Uint8Array(png);
    let pos = 8;
    while (true) {
        if (pos + 12 > pngData.length) {
            throw new Error("PNG data is too short");
        }
        let chunk_length = 0, chunk_type = "", chunk_data = null;
        for (let i = 0; i < 4; i++) {
            chunk_length = (chunk_length << 8) | pngData[pos++];
        }
        for (let i = 0; i < 4; i++) {
            chunk_type += String.fromCharCode(pngData[pos++]);
        }
        chunk_data = pngData.slice(pos, pos + chunk_length);
        if (pos + chunk_length + 4 > pngData.length) {
            throw new Error("Invalid PNG data length");
        }
        // Calculate CRC
        let crc = crc32(pngData.slice(pos - 4, pos + chunk_length))[0];
        pos += chunk_length;
        if ((crc >>> 0) !== ((pngData[pos] << 24 | pngData[pos + 1] << 16 | pngData[pos + 2] << 8 | pngData[pos + 3]) >>> 0)) {
            throw new Error("Invalid PNG CRC");
        }
        pos += 4;
        if (chunk_type === "pHYs") {
            if (chunk_length !== 9) {
                throw new Error("Invalid pHYs chunk length");
            }
            const x_dpm = chunk_data[0] << 24 | chunk_data[1] << 16 | chunk_data[2] << 8 | chunk_data[3];
            const y_dpm = chunk_data[4] << 24 | chunk_data[5] << 16 | chunk_data[6] << 8 | chunk_data[7];
            const unit = chunk_data[8];
            if (unit !== 1) {
                throw new Error("pHYs unit is not defined as meters");
            }
            return [x_dpm * 0.0254, y_dpm * 0.0254]; // Convert to inches
        }
        if (chunk_type === "IEND") {
            break; // End of PNG data
        }
    }
    throw new Error("No pHYs chunk found in PNG data");
}

const hex_to_uint8 = (hex) => {
    hex = hex.replace(/ /g, "");
    hex = hex.replace(/0[xX]/g, "");
    if (hex.length % 2 !== 0) {
        hex = "0" + hex;
    }
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        arr[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return arr;
}

let SpessaSynth_url_prefix = "https://cdn.jsdelivr.net/npm/spessasynth_lib@4.0.11/"

let load_idx = 0;
let global_vars = new Object();
let errormsg = "", candisplay = true;

let msczHtml = {
    ready: null,
    isReady: false,
    initializing: false,
    init: async () => {
        if (msczHtml.initializing || msczHtml.isReady) {
            return;
        }
        msczHtml.initializing = true;
        await import(SpessaSynth_url_prefix + "dist/index.js/+esm").then(m => [m.Sequencer, m.WorkletSynthesizer]).then(o => {
            global_vars.Sequencer = o[0];
            global_vars.WorkletSynthesizer = o[1];
        }).catch(error => {
            console.error(`Error loading SpessaSynth modules: ${error.message}`);
            errormsg = `Error loading SpessaSynth modules.`;
            candisplay = false;
        });

        msczHtml.isReady = true;
        console.log("msczHtml loaded successfully");

        let elements = document.querySelectorAll('[mscz-html]');
        for (const element of elements) {
            const jsonFile = element.getAttribute('mscz-html');
            const config = JSON.parse(element.getAttribute('mscz-config')) || null;
            msczHtml.displayMsczJson(element, jsonFile, config).catch(error => {
                console.error(`Error loading msczHtml: ${error.message}`);
            });
        }

        if (typeof msczHtml.ready === "function") {
            msczHtml.ready();
        }
    },
    /**
     * Renders and displays the specified JSON data into an HTML element.
     *
     * @async
     * @function displayMsczJson
     * @param {string|HTMLElement} cssSelector - A CSS selector string to select the target HTML element, or the target HTMLElement itself.
     * @param {string|Object} jsonFile - The URL string of the JSON file, or the JSON data object directly.
     * @param {Object|null} config - Configuration object for customizing rendering behavior (optional).
     * Available options:
     * - `autoScroll`: A boolean indicating whether to enable auto-scrolling (default: true).
     * - `audio`: An array, all items in the array should be objects with `src`, `name` and optional `measures` attribute. `measures` should be an array of objects with `id` and `time` attributes. `id` starts from 0 and `time` is in seconds.
     * - `soundfont`: A string (could be `GeneralUser` [default], `FluidR3_GM`, `MS Basic` or a URL to a soundfont file) or ArrayBuffer of a soundfont file.
     * - `exportDpi`: A number of DPI for exporting images (default: 330). To set this parameter, you need to add `-r [DPI]` to the command line when running you convert the mscz file to json. If not set, will try to read from pngs in the json file. If not found, will use 330.
     * 
     * @throws {Error} Throws an error if `cssSelector` is neither a string nor an HTMLElement.
     * @throws {Error} Throws an error if the specified HTML element cannot be found.
     * @throws {Error} Throws an error if `jsonFile` is neither a string nor an object.
     * @throws {Error} Throws an error if the JSON data is missing required keys (e.g., `svgs`, `mposXML`, `metadata`, `midi`).
     * 
     * @example
     * // Using a CSS selector to load JSON data
     * msczHtml.displayMsczJson('#my-element', 'path/to/data.json', { autoScroll: true });
     * 
     * @example
     * // Using an HTMLElement and directly passing JSON data
     * const element = document.getElementById('my-element');
     * const jsonData = { svgs: [...], mposXML: "...", metadata: {...}, midi: "..." };
     * msczHtml.displayMsczJson(element, jsonData, { autoScroll: false });
     */
    displayMsczJson: async (cssSelector, jsonFile, config) => {
        let currentId = load_idx++;
        let element;

        if (typeof cssSelector === 'object' && cssSelector instanceof HTMLElement) {
            element = cssSelector;
        } else if (typeof cssSelector === 'string') {
            element = document.querySelector(cssSelector);
        } else {
            throw new Error(`Invalid selector type: ${typeof cssSelector}`);
        }

        if (!element) {
            throw new Error(`Element with selector ${cssSelector} not found`);
        }

        if (!candisplay) {
            element.innerHTML = `<div class="mscz-error">${errormsg}</div>`;
            return;
        }

        let data;
        if (typeof jsonFile === "string") {
            const response = await fetch(jsonFile);
            if (!response.ok) {
                throw new Error(`Failed to fetch JSON file: ${response.statusText}`);
            }
            data = await response.json();
        } else if (typeof jsonFile === "object") {
            data = jsonFile;
        } else {
            throw new Error(`Invalid JSON file type: ${typeof jsonFile}.`);
        }

        // Validate the data structure
        if (!data || !data.svgs || !data.mposXML || !data.metadata || !data.midi) {
            throw new Error(`Missing expected keys in JSON data`);
        }

        // Construct the HTML string
        let html = `<div class="mscz-player-controls" mscz-disabled>`;
        html += `<div class="mscz-player-controls-buttons">`;
        html += `<button class="mscz-button mscz-play-button"></button>`;
        html += `<button class="mscz-button mscz-pause-button"></button>`;
        html += `<button class="mscz-button mscz-back-button"></button>`;
        html += `</div>`;
        html += `<div class="mscz-player-controls-select">`;
        html += `<select class="mscz-track-select">`;
        html += `<option value="0">MIDI</option>`;
        html += `</select>`;
        html += `</div>`;
        html += `<div class="mscz-player-scroll">`;
        html += `<input type="checkbox" ${((config && config.autoScroll !== undefined && config.autoScroll) || true) ? "checked" : ""}>Auto Scroll</button>`;
        html += `</div>`;
        html += `<div class="mscz-player-controls-time">${numberToTime(0)} / ${numberToTime(data.metadata.duration)}</div>`;
        html += `<div class="mscz-player-controls-seek">`;
        html += `<input type="range" class="mscz-seek-bar" min="0" max="${data.metadata.duration * 10}">`;
        html += `</div></div>`;
        element.innerHTML = html;
        element.querySelector("input[type=range]").value = 0;

        // Load SVG images
        const picElements = document.createElement('div');
        picElements.classList.add('mscz-images-container');
        element.appendChild(picElements);
        const svg_viewPorts = [];
        for (const svg of data.svgs) {
            const singleImgContainer = document.createElement('div');
            singleImgContainer.classList.add('mscz-image-container');
            const singleImgBox = document.createElement('div');
            singleImgBox.classList.add('mscz-image-box');
            const img = document.createElement('img');
            img.src = `data:image/svg+xml;base64,${svg}`;
            img.classList.add('mscz-svg-image');
            singleImgContainer.appendChild(singleImgBox);
            singleImgBox.appendChild(img);
            picElements.appendChild(singleImgContainer);
            const parsedSvg = new DOMParser().parseFromString(atob(svg), "image/svg+xml");
            svg_viewPorts.push(parsedSvg.querySelector("svg").viewBox.baseVal);
        }

        if (!config || !config.exportDpi) {
            config = config || {};
            config.exportDpi = 330;
            if (data.pngs) {
                for (const png of data.pngs) {
                    try {
                        const pngData = atob(png);
                        const pngByteNumbers = new Array(pngData.length);
                        for (let i = 0; i < pngData.length; i++) {
                            pngByteNumbers[i] = pngData.charCodeAt(i);
                        }
                        const pngByteArray = new Uint8Array(pngByteNumbers);
                        const pngArrayBuffer = pngByteArray.buffer;
                        const dpi = get_png_dpi(pngArrayBuffer);
                        if (dpi[0] !== dpi[1]) {
                            continue;
                        }
                        config.exportDpi = dpi[0];
                        break;
                    } catch (error) {
                        console.error(`Error getting DPI from PNG: ${error.message}`);
                        errormsg = `Error getting DPI from PNG. Defaulting to 330.`;
                    }
                }
            }
        }
        let posRatio = config.exportDpi / 30;
        // Load mposXML
        const mposXML = atob(data.mposXML);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(mposXML, "text/xml");
        for (const measure of xmlDoc.getElementsByTagName("element")) {
            const measure_element = document.createElement('div');
            const measure_page = parseInt(measure.getAttribute("page"));
            const measure_x = parseFloat(measure.getAttribute("x")) / posRatio;
            const measure_y = parseFloat(measure.getAttribute("y")) / posRatio;
            const measure_width = parseFloat(measure.getAttribute("sx")) / posRatio;
            const measure_height = parseFloat(measure.getAttribute("sy")) / posRatio;
            measure_element.classList.add('mscz-measure-overlay');
            measure_element.style.left = `${measure_x / svg_viewPorts[measure_page].width * 100}%`;
            measure_element.style.top = `${measure_y / svg_viewPorts[measure_page].height * 100}%`;
            measure_element.style.width = `${measure_width / svg_viewPorts[measure_page].width * 100}%`;
            measure_element.style.height = `${measure_height / svg_viewPorts[measure_page].height * 100}%`;
            measure_element.id = `mscz-measure-${currentId}-${measure.getAttribute("id")}`;
            picElements.childNodes[measure_page].childNodes[0].appendChild(measure_element);
        }
        let times = [[]];
        for (const measure of xmlDoc.getElementsByTagName("event")) {
            times[0].push({ id: parseInt(measure.getAttribute("elid")), time: parseFloat(measure.getAttribute("position")) / 1000 });
            var measure_element = element.querySelector(`#mscz-measure-${currentId}-${measure.getAttribute("elid")}`);
            if (measure_element && !measure_element.hasAttribute("time")) {
                measure_element.setAttribute("time", parseFloat(measure.getAttribute("position")) / 1000);
            }
        }
        times[0].sort((a, b) => a.time - b.time);

        if (!config || !config.soundfont) {
            config = config || {};
            config.soundfont = "GeneralUser";
        }
        let soundfont_url = null, sf3;
        if (config.soundfont === "GeneralUser") {
            soundfont_url = "/asset/GeneralUserGS.sf3";
        }
        else if (config.soundfont === "FluidR3_GM") {
            soundfont_url = "https://raw.githubusercontent.com/musescore/MuseScore/refs/tags/v2.1.0/share/sound/FluidR3Mono_GM.sf3";
        }
        else if (config.soundfont === "MS Basic") {
            soundfont_url = "https://raw.githubusercontent.com/musescore/MuseScore/refs/tags/v4.0/share/sound/MS%20Basic.sf3";
        }
        else if (typeof config.soundfont === "string") {
            soundfont_url = config.soundfont;
        }
        if (soundfont_url) {
            sf3 = await fetch(soundfont_url).catch(error => {
                console.error(`Error loading soundfont: ${error.message}`);
                errormsg = `Error loading soundfont. No MIDI playback available.`;
            }).then(response => response.arrayBuffer());
        }
        else if (config.soundfont instanceof ArrayBuffer) {
            sf3 = config.soundfont;
        }
        else {
            throw new Error(`Invalid soundfont type: ${typeof config.soundfont}.`);
        }

        let midi_player, loaded = false;
        let audio_players = [midi_player];
        if (config && config.audio) {
            for (let i = 0; i < config.audio.length; i++) {
                const audio = config.audio[i];
                if (audio.src && audio.name) {
                    let audio_player = new Audio();
                    audio_player.crossOrigin = "*";
                    audio_player.loop = true;
                    // We don't need to set the src here to avoid preloading the audio
                    if (audio.measures) {
                        times.push([]);
                        for (let measure of audio.measures) {
                            times[i + 1].push({ id: measure.id, time: measure.time });
                        }
                    }
                    else {
                        times.push(times[0]);
                    }
                    times[i + 1].sort((a, b) => a.time - b.time);
                    element.querySelector(".mscz-track-select").innerHTML += `<option value="${i + 1}">${audio.name}</option>`;
                    audio_players.push(audio_player);
                }
            }
        }

        element.querySelector(".mscz-track-select").onchange = () => {
            let track_id = parseInt(element.querySelector("select").value);
            for (let i = 0; i < audio_players.length; i++) {
                if (audio_players[i] && !audio_players[i].paused) {
                    audio_players[i].pause();
                }
            }
            if (track_id > 0 && !audio_players[track_id].src) {
                audio_players[track_id].src = config.audio[track_id - 1].src;
            }
            for (let i of element.querySelectorAll(".mscz-measure-overlay")) {
                i.removeAttribute("time");
                i.classList.remove("mscz-measure-overlay-current");
            }
            for (let i of times[track_id]) {
                var measure_element = element.querySelector(`#mscz-measure-${currentId}-${i.id}`);
                if (measure_element && !measure_element.hasAttribute("time")) {
                    measure_element.setAttribute("time", i.time);
                }
            }
        }

        const slider = element.querySelector("input[type=range]");
        const setCurrentTime = (time) => {
            let track_id = parseInt(element.querySelector("select").value);
            element.querySelector(".mscz-player-controls-time").innerText = `${numberToTime(time)} / ${numberToTime(audio_players[track_id].duration)}`;
            // Only adjust the slider if it is not active
            if (!slider.matches(':active')) {
                slider.value = time * 10;
                if (audio_players[track_id]) {
                    slider.setAttribute("max", audio_players[track_id].duration * 10);
                }
            }
            let times_current = times[track_id];
            let idx = bisect_right(times_current, time, 0, times_current.length, (x) => x.time) - 1;
            if (idx >= 0) {
                let measure_element = element.querySelector(`#mscz-measure-${currentId}-${times_current[idx].id}`);
                if (measure_element) {
                    if (!measure_element.classList.contains("mscz-measure-overlay-current")) {
                        let measure_elements = element.querySelectorAll(".mscz-measure-overlay-current");
                        for (let i = 0; i < measure_elements.length; i++) {
                            measure_elements[i].classList.remove("mscz-measure-overlay-current");
                        }
                        measure_element.classList.add("mscz-measure-overlay-current");
                        if (element.querySelector(".mscz-player-scroll input").checked) {
                            measure_element.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                    }
                }
            }
        }
        const adjustCurrentTime = (time) => {
            let track_id = parseInt(element.querySelector("select").value);
            audio_players[track_id].currentTime = time;
            for (let i = 0; i < audio_players.length; i++) {
                if (audio_players[i] && i != track_id && !audio_players[i].paused) {
                    audio_players[i].pause();
                }
            }
        }

        const midiData = atob(data.midi);
        const midi_byteNumbers = new Array(midiData.length);
        for (let i = 0; i < midiData.length; i++) {
            midi_byteNumbers[i] = midiData.charCodeAt(i);
        }
        const midi_byteArray = new Uint8Array(midi_byteNumbers);
        const midi_arrayBuffer = midi_byteArray.buffer;
        element.querySelector(".mscz-player-controls").removeAttribute("mscz-disabled");
        element.querySelector(".mscz-play-button").addEventListener("click", async () => {
            if (!loaded) {
                element.querySelector(".mscz-player-controls").setAttribute("mscz-disabled", "");
                if (sf3) {
                    let context = new AudioContext();
                    await context.audioWorklet.addModule(new URL(SpessaSynth_url_prefix + "dist/spessasynth_processor.min.js"));
                    let synth = new global_vars.WorkletSynthesizer(context);
                    synth.connect(context.destination);
                    await synth.soundBankManager.addSoundBank(sf3, "main");
                    midi_player = new global_vars.Sequencer(synth);
                    midi_player.loadNewSongList([{
                        binary: midi_arrayBuffer,
                        altName: "midi",
                    }]);
                    audio_players[0] = midi_player;
                }
                slider.onchange = () => {
                    adjustCurrentTime(slider.value / 10);
                }
                for (let i of element.querySelectorAll(".mscz-measure-overlay")) {
                    i.onclick = () => {
                        adjustCurrentTime(i.getAttribute("time"));
                    }
                }
                setInterval(() => {
                    let track_id = parseInt(element.querySelector("select").value);
                    if (audio_players[track_id] && !audio_players[track_id].paused) {
                        setCurrentTime(audio_players[track_id].currentTime);
                    }
                }, 100);
                loaded = true;
            }
            let track_id = parseInt(element.querySelector("select").value);
            if (audio_players[track_id]) {
                audio_players[track_id].play();
            }
            element.querySelector(".mscz-player-controls").removeAttribute("mscz-disabled");
        });
        element.querySelector(".mscz-pause-button").addEventListener("click", () => {
            if (!loaded) { return };
            for (let i = 0; i < audio_players.length; i++) {
                if (audio_players[i] && !audio_players[i].paused) {
                    audio_players[i].pause();
                }
            }
        });
        element.querySelector(".mscz-back-button").addEventListener("click", () => {
            if (!loaded) { return };
            for (let i = 0; i < audio_players.length; i++) {
                if (audio_players[i]) {
                    audio_players[i].currentTime = 0;
                    audio_players[i].pause();
                }
            }
            let track_id = parseInt(element.querySelector("select").value);
            if (audio_players[track_id]) {
                setCurrentTime(0);
            }
        });
    }
};

const loadModule = () => {
    msczHtml.init();
    window.msczHtml = msczHtml;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadModule);
} else {
    loadModule();
}

export default msczHtml;
