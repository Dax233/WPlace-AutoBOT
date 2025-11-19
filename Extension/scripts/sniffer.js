// F:\github\WPlace-AutoBOT\Extension\scripts\sniffer.js
(function() {
    // 防止重复注入
    if (window.__PAWTECT_HOOK__) return;
    window.__PAWTECT_HOOK__ = true;

    console.log("%c✅ [AutoBOT] Signer Ready (Stealth Mode)", "color: #00ff00; font-weight: bold;");

    // 辅助：创建隐形 spy exports
    function createSpyExports(originalExports) {
        const spy = {};
        for (const key in originalExports) {
            const value = originalExports[key];
            if (typeof value === 'function') {
                // 我们不再拦截日志，直接透传，为了性能和稳定性
                spy[key] = value.bind(originalExports);
            } else {
                Object.defineProperty(spy, key, { get: () => originalExports[key] });
            }
        }
        return spy;
    }

    // 1. 劫持 WASM 实例化 (获取活体实例)
    const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
    WebAssembly.instantiateStreaming = async function(source, importObject) {
        const result = await originalInstantiateStreaming(source, importObject);
        // 保存实例供签名器使用
        window.__WASM_INSTANCE__ = result.instance;
        
        // 隐形替换 exports，确保网页代码继续正常运行，不报错
        try {
            const spyExports = createSpyExports(result.instance.exports);
            Object.defineProperty(result.instance, 'exports', {
                value: spyExports,
                writable: false,
                configurable: true
            });
        } catch (e) {
            // 如果替换失败也没关系，只要拿到 window.__WASM_INSTANCE__ 就行
        }
        return result;
    };

    // 2. 暴露给扩展的签名器
    window.__WPLACE_signer = function(regionX, regionY, payloadJsonString) {
        const wasm = window.__WASM_INSTANCE__;
        if (!wasm) {
            console.error("❌ [Signer] WASM not ready. Please refresh page.");
            return null;
        }

        const exports = wasm.exports; // 这里拿到的是原始 exports (通过 bind)
        const malloc = exports.__wbindgen_malloc;
        const free = exports.__wbindgen_free;

        try {
            const encoder = new TextEncoder();

            // 🎯 锁定正确格式：绝对路径 URL
            const urlStr = `https://backend.wplace.live/s0/pixel/${regionX}/${regionY}`;
            
            // 1. 写入 URL
            const urlBytes = encoder.encode(urlStr);
            const urlPtr = malloc(urlBytes.length);
            new Uint8Array(exports.memory.buffer).set(urlBytes, urlPtr);
            
            // 调用 request_url (因为是活体实例，UserID 肯定有了，不会崩)
            exports.request_url(urlPtr, urlBytes.length);
            free(urlPtr, urlBytes.length);

            // 2. 写入 Payload
            const payloadBytes = encoder.encode(payloadJsonString);
            const jsonPtr = malloc(payloadBytes.length);
            new Uint8Array(exports.memory.buffer).set(payloadBytes, jsonPtr);

            // 3. 生成 Token
            const result = exports.get_pawtected_endpoint_payload(jsonPtr, payloadBytes.length);
            free(jsonPtr, payloadBytes.length);

            // 4. 读取结果
            const resPtr = Array.isArray(result) ? result[0] : result;
            if (resPtr > 0) {
                const mem = new Uint8Array(exports.memory.buffer);
                let end = resPtr;
                while (mem[end] !== 0 && (end - resPtr) < 4096) end++;
                const token = new TextDecoder().decode(mem.slice(resPtr, end));
                return token;
            }
        } catch (e) {
            console.error("❌ [Signer] Error:", e);
        }
        return null;
    };
})();