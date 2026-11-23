
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve("node_modules");

function isBinary(filePath) {
    const fd = fs.openSync(filePath, "r");

    try {
        const buffer = Buffer.alloc(8192);
        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);

        if (bytesRead === 0) return false;

        const data = buffer.subarray(0, bytesRead);

        // Détection des signatures binaires connues
        const signatures = [
            [0x7F, 0x45, 0x4C, 0x46], // ELF
            [0x4D, 0x5A],             // EXE / DLL
            [0xCA, 0xFE, 0xBA, 0xBE], // Mach-O / Fat
            [0xFE, 0xED, 0xFA, 0xCE], // Mach-O
            [0xFE, 0xED, 0xFA, 0xCF], // Mach-O 64
            [0x00, 0x61, 0x73, 0x6D]  // WASM
        ];

        if (signatures.some(sig =>
            sig.every((byte, i) => data[i] === byte)
        )) return true;

        // Détection des octets nuls
        if (data.includes(0)) return true;

        // Détection des caractères non imprimables
        let invalid = 0;

        for (const byte of data) {
            if (
                (byte < 32 && ![9, 10, 13].includes(byte)) ||
                byte === 127
            ) {
                invalid++;
            }
        }

        return invalid / bytesRead > 0.10;
    } finally {
        fs.closeSync(fd);
    }
}

function scanDirectory(directory) {
    const binaries = [];
    const texts = [];

    function walk(dir) {
        let entries;

        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            try {
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile()) {
                    if (isBinary(fullPath)) {
                        binaries.push(fullPath);
                    } else {
                        texts.push(fullPath);
                    }
                }
            } catch {}
        }
    }

    walk(directory);

    return { binaries, texts };
}

if (!fs.existsSync(ROOT)) {
    console.error("Dossier node_modules introuvable !");
    process.exit(1);
}

console.log("Analyse de node_modules...\n");

const result = scanDirectory(ROOT);

console.log("========== BINAIRES ==========");
result.binaries.forEach(file => console.log("[BIN]", file));

console.log("\n========== FICHIERS TEXTE ==========");
result.texts.forEach(file => console.log("[TXT]", file));

console.log("\n========== RÉSULTAT ==========");
console.log("Binaires :", result.binaries.length);
console.log("Textes   :", result.texts.length);
console.log("Total    :", result.binaries.length + result.texts.length);
