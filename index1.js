import {
    ethers,
    Wallet,
    JsonRpcProvider,
    Contract
} from "ethers"
import fs from "fs"
import chalk from "chalk"
import { keccak_256 } from "@noble/hashes/sha3";
import axios from "axios"

const NETWORK = "standard"
const RPC_URL = "https://evmrpc-testnet.0g.ai"
const PROXY_ADDRESS = "0x0460aA47b41a66694c0a73f667a1b795A5ED3556"
const STORAGE_API_URL = `https://indexer-storage-testnet-${NETWORK}.0g.ai`
const MIN_BALANCE = ethers.parseEther("0.001")
const OUTPUT_DIR = "./output"
const LOGS_DIR = "./logs"
const UPLOADS_LOG = "./uploads_log.json"
const FLOW_ABI = [
    "function market() external view returns (address)",
    "function submit((uint256,bytes,(bytes32,uint256)[])) payable returns (uint256,bytes32,uint256,uint256)"
]

let PRIVATE_KEYS = []
try {
    const data = JSON.parse(fs.readFileSync("./accounts1.json", "utf8"))
    PRIVATE_KEYS = data
    console.log(chalk.blue(`Loaded ${PRIVATE_KEYS.length} keys from accounts1.json`))
} catch {
    console.log(chalk.yellow("No valid accounts1.json; using fallback key"))
    PRIVATE_KEYS = ["YOUR_FALLBACK_PRIVATE_KEY"]
}

function loadUploads() {
    if (!fs.existsSync(UPLOADS_LOG)) return { uploads: [] }
    try {
        return JSON.parse(fs.readFileSync(UPLOADS_LOG, "utf8"))
    } catch {
        return { uploads: [] }
    }
}

function saveUpload(record) {
    const logs = loadUploads()
    logs.uploads.push({ ...record, timestamp: new Date().toISOString() })
    fs.writeFileSync(UPLOADS_LOG, JSON.stringify(logs, null, 2))
}

function generateFile() {
    const now = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "")
    const fid = Math.random().toString(36).slice(2, 10)
    const fname = `backup_${now}_${fid}.txt`
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    const lines = []
    lines.push(`# Backup created at ${new Date().toISOString()}`)
    for (let i = 0; i < 5; i++) {
        lines.push(`line-${i}: ${Math.random()}`)
    }
    const content = lines.join("\n")
    const fpath = `${OUTPUT_DIR}/${fname}`
    fs.writeFileSync(fpath, content)
    return { path: fpath, size: content.length, content }
}

async function checkFileInfo(rootHash, maxAttempts = 25) {
    console.log(chalk.yellow('Checking File Info'))
    console.log(chalk.blue('Root Hash:'), rootHash)

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(chalk.blue(`Attempt ${attempt}/${maxAttempts}`))
            
            const response = await axios({
                method: 'get',
                url: `${STORAGE_API_URL}/file/info/${rootHash}`,
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                    'cache-control': 'no-cache',
                    'origin': 'https://storagescan-newton.0g.ai',
                    'pragma': 'no-cache',
                    'referer': 'https://storagescan-newton.0g.ai/',
                    'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"macOS"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-site',
                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
                }
            })

            console.log(chalk.blue('Response Status:'), response.status)
            console.log(chalk.blue('Response Body:'), JSON.stringify(response.data))

            if (response.data.code === 101) {
                console.log(chalk.yellow(`Waiting for file registration`))
                await new Promise(resolve => setTimeout(resolve, 2000))
                continue
            }


            if (!response.data.data || !response.data.data.tx) {
                console.log(chalk.yellow(`Waiting for file registration`))
                await new Promise(resolve => setTimeout(resolve, 2000))
                continue
            }

            return response.data.data;
        } catch (error) {
            console.error(chalk.red(`Error checking file info (Attempt ${attempt}):`, error.message))
            await new Promise(resolve => setTimeout(resolve, 2000))
        }
    }

    return null;
}

function padToExact256(buffer) {
    const TARGET_SIZE = 256; // Ukuran tepat 256 bytes seperti di sistem 0G
    
    // Jika ukurannya sudah 256, gunakan apa adanya
    if (buffer.length === TARGET_SIZE) {
        return buffer;
    }
    
    // Buat buffer baru dengan ukuran tepat 256 bytes
    const paddedBuffer = Buffer.alloc(TARGET_SIZE);
    
    // Salin data asli (sisanya akan menjadi null bytes/0x00)
    buffer.copy(paddedBuffer);
    
    return paddedBuffer;
}

async function postUploadSegment(rootHash, index, data, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(chalk.yellow(`Uploading segment attempt ${attempt}/${maxRetries}`));
            
            const payload = {
                root: rootHash,
                index: index,
                data: data,
                proof: {
                    lemma: [rootHash],
                    path: []
                }
            };
            
            console.log(chalk.cyan(`Request payload prepared (abbreviated):`));
            console.log(chalk.cyan(`- root: ${rootHash}`));
            console.log(chalk.cyan(`- index: ${index}`));
            console.log(chalk.cyan(`- data length: ${data.length} chars`));
            console.log(chalk.cyan(`- proof: { lemma: [${rootHash}], path: [] }`));
            
            const debugFilename = `${LOGS_DIR}/payload_${Date.now()}.json`;
            fs.writeFileSync(debugFilename, JSON.stringify(payload, null, 2));
            console.log(chalk.cyan(`Full payload written to ${debugFilename}`));
            
            const response = await axios({
                method: 'post',
                url: `${STORAGE_API_URL}/file/segment`,
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                    'cache-control': 'no-cache',
                    'content-type': 'application/json',
                    'origin': 'https://storagescan-newton.0g.ai',
                    'pragma': 'no-cache',
                    'priority': 'u=1, i',
                    'referer': 'https://storagescan-newton.0g.ai/',
                    'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"macOS"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-site',
                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
                },
                data: payload
            });
            
            console.log(chalk.cyan(`Response status: ${response.status}`));
            console.log(chalk.cyan(`Response data: ${JSON.stringify(response.data)}`));
            
            if (response.status === 200 && response.data && response.data.code === 0) {
                console.log(chalk.green(`Segment ${index} upload successful`));
                return { success: true };
            } else {
                console.log(chalk.yellow(`Unexpected response: ${JSON.stringify(response.data)}`));
                if (attempt < maxRetries) {
                    const delay = 2000 * attempt;
                    console.log(chalk.yellow(`Waiting ${delay}ms before retry...`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        } catch (error) {
            console.error(chalk.red(`Segment ${index} upload failed (Attempt ${attempt}):`, error.message));
            
            if (error.response) {
                console.error(chalk.red(`Response status: ${error.response.status}`));
                console.error(chalk.red(`Response data: ${JSON.stringify(error.response.data || "")}`));
            }
            
            if (attempt < maxRetries) {
                const delay = 2000 * attempt;
                console.log(chalk.yellow(`Waiting ${delay}ms before retry...`));
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    return { success: false, message: "Max retries exceeded" };
}

async function uploadSegments(fileBuf, rootHash) {
    console.log(chalk.cyan(`Preparing to upload file of ${fileBuf.length} bytes`));
    
    const paddedBuffer = padToExact256(fileBuf);
    console.log(chalk.cyan(`Padded buffer size: ${paddedBuffer.length} bytes`));
    
    const base64Data = paddedBuffer.toString('base64');
    console.log(chalk.blue(`Base64 Length: ${base64Data.length}`));
    
    const payload = {
        root: rootHash,
        index: 0,
        data: base64Data,
        proof: {
            lemma: [rootHash],
            path: []
        }
    };
    
    const debugFilename = `${LOGS_DIR}/payload_${Date.now()}.json`;
    fs.writeFileSync(debugFilename, JSON.stringify(payload, null, 2));
    console.log(chalk.blue(`Full payload written to ${debugFilename}`));
    
    try {
        const uploadResult = await postUploadSegment(rootHash, 0, base64Data);
        
        if (uploadResult.success) {
            console.log(chalk.green('Upload successful!'));
            return { success: true };
        }
        
        console.log(chalk.yellow("Upload gagal meskipun menggunakan format yang benar."));
        console.log(chalk.yellow("Coba periksa rootHash yang digunakan."));
        
        throw new Error("Failed to upload file segment");
    } catch (error) {
        console.log(chalk.red(`Upload failed: ${error.message}`));
        throw error;
    }
}

async function checkBalance(wallet) {
    const bal = await wallet.provider.getBalance(wallet.address)
    return { balance: bal, hasEnough: bal >= MIN_BALANCE }
}

async function calculateStorageFee(provider, fileSize) {
    const flow = new Contract(PROXY_ADDRESS, ["function market() external view returns (address)"], provider)
    const marketAddr = await flow.market()
    const market = new Contract(marketAddr, ["function pricePerSector() external view returns (uint256)"], provider)
    const pps = await market.pricePerSector()
    const sectorSize = 4096
    const sectors = Math.ceil(fileSize / sectorSize)
    return pps * BigInt(sectors)
}

function fileHash(buffer) {
    return "0x" + Buffer.from(keccak_256(buffer)).toString("hex");
}

function calculateRootHash(buffer) {
    const paddedBuffer = padToExact256(buffer);
    return "0x" + Buffer.from(keccak_256(paddedBuffer)).toString("hex");
}

async function doUpload(privateKey) {
    const { path: fp, size: fsize, content } = generateFile()
    console.log(chalk.cyan("Generated file:"), chalk.yellow(fp.split("/").pop()))
    console.log(chalk.cyan("File size:"), chalk.yellow(`${fsize} bytes`))

    const fileBuf = Buffer.from(content)
    
    const rootHash = calculateRootHash(fileBuf)
    
    const originalHash = fileHash(fileBuf)
    console.log(chalk.cyan("Original hash:"), chalk.yellow(originalHash))
    console.log(chalk.cyan("Root hash (padded):"), chalk.yellow(rootHash))
    
    const provider = new JsonRpcProvider(RPC_URL)
    const wallet = new Wallet(privateKey, provider)
    console.log(chalk.cyan("Connected with address:"), chalk.yellow(wallet.address))

    const { balance, hasEnough } = await checkBalance(wallet)
    console.log(chalk.cyan("Wallet balance:"), chalk.yellow(ethers.formatEther(balance)), "A0GI")
    if (!hasEnough) {
        console.log(chalk.red("Insufficient balance"))
        fs.unlinkSync(fp)
        return { success: false, reason: "balance_low" }
    }

    let storageFee
    try {
        storageFee = await calculateStorageFee(provider, fsize)
    } catch {
        storageFee = ethers.parseUnits("0.00000286102294922", "ether")
    }
    console.log(chalk.magenta("Calculated storage fee:"), ethers.formatEther(storageFee), "A0GI")

    let fileInfo = await checkFileInfo(rootHash, 3);
    if (fileInfo && fileInfo.finalized) {
        console.log(chalk.yellow("File already exists and is finalized"));
        fs.unlinkSync(fp);
        return { 
            success: true, 
            rootHash,
            message: "File already exists and is finalized" 
        };
    }

    const submission = [
        BigInt(fsize),
        "0x",
        [
            [rootHash, 0n]
        ]
    ]

    const flow = new Contract(PROXY_ADDRESS, FLOW_ABI, wallet)
    let gasEst, gasPrice
    try {
        gasEst = await flow.estimateGas.submit(submission, { value: storageFee })
        gasPrice = await provider.getGasPrice()
    } catch {
        gasEst = 600000n
        gasPrice = ethers.parseUnits("1", "wei")
    }
    const gasFee = gasEst * gasPrice
    const totalFee = gasFee + storageFee
    console.log(chalk.magenta("Fees:"), ethers.formatEther(totalFee), "A0GI")
    console.log(chalk.magenta("Gas Fee:"), ethers.formatEther(gasFee), "A0GI")
    console.log(chalk.magenta("Storage Node Fee:"), ethers.formatEther(storageFee), "A0GI")
    console.log(chalk.cyan("Submitting transaction..."))

    let tx
    try {
        tx = await flow.submit(submission, {
            value: storageFee,
            gasLimit: gasEst + 50000n,
            gasPrice
        })
        console.log(chalk.cyan("Transaction sent:"), chalk.green(tx.hash))
    } catch (txErr) {
        console.log(chalk.red("Transaction failed to send:"), txErr)
        fs.unlinkSync(fp)
        return { success: false, reason: "tx_failed" }
    }

    console.log(chalk.cyan("Waiting for confirmation..."))
    let receipt
    try {
        receipt = await tx.wait()
    } catch (waitErr) {
        console.log(chalk.red("Error waiting for tx:"), waitErr)
        fs.unlinkSync(fp)
        return { success: false, reason: "tx_wait_fail" }
    }

    if (!receipt || receipt.status === 0) {
        console.log(chalk.red("Transaction reverted on chain"))
        fs.unlinkSync(fp)
        return { success: false, reason: "tx_revert" }
    }
    console.log(chalk.cyan("Transaction confirmed in block:"), chalk.yellow(receipt.blockNumber))
    console.log(chalk.cyan("Registration transaction complete"))

    console.log(chalk.cyan("Waiting for transaction to be indexed..."));
    await new Promise(resolve => setTimeout(resolve, 10000));

    let uploadedSegment = 0;
    let maxRetries = 15;
    let fileInfoAfterTx = null;
    
    for (let i = 0; i < maxRetries; i++) {
        console.log(chalk.cyan(`Checking file info after transaction (attempt ${i+1}/${maxRetries})...`));
        fileInfoAfterTx = await checkFileInfo(rootHash);
        
        if (fileInfoAfterTx) {
            console.log(chalk.green("File registered successfully!"));
            if (fileInfoAfterTx.uploadedSegNum) {
                uploadedSegment = fileInfoAfterTx.uploadedSegNum;
                console.log(chalk.blue(`Already uploaded segments: ${uploadedSegment}`));
            }
            break;
        }
        
        console.log(chalk.yellow(`File not found yet, waiting 3 seconds...`));
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    if (!fileInfoAfterTx) {
        console.log(chalk.red("Failed to verify file registration after transaction"));
        fs.unlinkSync(fp);
        return { success: false, reason: "file_registration_failed" };
    }
    
    if (fileInfoAfterTx.finalized) {
        console.log(chalk.green("File already finalized!"));
        fs.unlinkSync(fp);
        return { 
            success: true, 
            rootHash,
            txHash: tx.hash,
            fileSize: fsize,
            walletAddress: wallet.address,
            gasFee: gasFee.toString(),
            storageNodeFee: storageFee.toString(),
            seq: fileInfoAfterTx.tx.seq,
            submissionMonitor: `https://storagescan-newton.0g.ai/file/${rootHash}`
        };
    }

    console.log(chalk.cyan("Beginning segment uploads..."));
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
        await uploadSegments(fileBuf, rootHash);
    } catch (error) {
        console.log(chalk.red("Error during segment uploads:"), error.message);
        fs.unlinkSync(fp);
        return { 
            success: false, 
            reason: "segment_upload_failed",
            error: error.message 
        };
    }

    console.log(chalk.cyan("Verifying file finalization..."));
    let isFinalized = false;
    
    for (let i = 0; i < 10; i++) {
        const finalStatus = await checkFileInfo(rootHash);
        if (finalStatus && finalStatus.finalized) {
            console.log(chalk.green("File successfully finalized!"));
            isFinalized = true;
            break;
        }
        
        console.log(chalk.yellow(`File not finalized yet, checking again in 5 seconds...`));
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    if (!isFinalized) {
        console.log(chalk.yellow("File may not be fully finalized yet, but upload completed."));
    }

    fs.unlinkSync(fp);
    console.log(chalk.cyan("File deleted after upload"));

    const res = {
        success: true,
        rootHash,
        txHash: tx.hash,
        fileSize: fsize,
        walletAddress: wallet.address,
        gasFee: gasFee.toString(),
        storageNodeFee: storageFee.toString(),
        seq: fileInfoAfterTx.tx.seq,
        submissionMonitor: `https://storagescan-newton.0g.ai/file/${rootHash}`
    }
    saveUpload(res);
    return res;
}

async function runLoop() {
    while (true) {
        console.log(chalk.blue("Bot started, repeating tasks every 10 minutes"))
        console.log(chalk.blue("Running job..."))

        const results = []
        for (let i = 0; i < PRIVATE_KEYS.length; i++) {
            console.log(chalk.blue(`Processing wallet ${i + 1}/${PRIVATE_KEYS.length}`))
            try {
                const outcome = await doUpload(PRIVATE_KEYS[i])
                results.push(outcome)
            } catch (e) {
                console.log(chalk.red(`Error with wallet ${i + 1}:`), e)
                results.push({ success: false, reason: "error" })
            }
        }

        console.log(chalk.blue("\n===== Upload Summary ====="))
        results.forEach((r, idx) => {
            if (r.success) {
                console.log(
                    chalk.green(`Wallet ${idx + 1}: Success`),
                    chalk.yellow(`RootHash: ${r.rootHash.substring(0, 10)}...`),
                    chalk.white(`GasFee: ${ethers.formatEther(r.gasFee || "0")} A0GI`),
                    chalk.white(`StorageFee: ${ethers.formatEther(r.storageNodeFee || "0")} A0GI`)
                )
            } else {
                console.log(chalk.red(`Wallet ${idx + 1}: Failed`), chalk.yellow(`Reason: ${r.reason}`))
            }
        })

        console.log(chalk.yellow("Waiting 10 minutes before next run..."))
        await new Promise(res => setTimeout(res, 10 * 60 * 1000))
    }
}

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true })
    console.log(chalk.blue("\n===== 0G Network File Uploader =====\n"))
    await runLoop()
}

main().catch(err => {
    console.log(chalk.red("Fatal error:"), err)
    process.exit(1)
})