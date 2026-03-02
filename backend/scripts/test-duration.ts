import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { getVideoDuration } from "../src/services/metadataService";

const TEST_VIDEO_PATH = path.join(__dirname, "test_video.mp4");

async function createTestVideo() {
    return new Promise<void>((resolve, reject) => {
        // Create a 5-second black video
        exec(`ffmpeg -f lavfi -i color=c=black:s=320x240:d=5 -c:v libx264 "${TEST_VIDEO_PATH}" -y`, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

async function runTest() {
    try {
        console.log("Creating test video...");
        await createTestVideo();
        console.log("Test video created.");

        console.log("Getting duration...");
        const duration = await getVideoDuration(TEST_VIDEO_PATH);
        console.log(`Duration: ${duration}`);

        if (duration === 5) {
            console.log("SUCCESS: Duration is correct.");
        } else {
            console.error(`FAILURE: Expected duration 5, got ${duration}`);
            process.exit(1);
        }
    } catch (error) {
        console.error("Test failed:", error);
        process.exit(1);
    } finally {
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        if (fs.existsSync(TEST_VIDEO_PATH)) {
            // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
            fs.unlinkSync(TEST_VIDEO_PATH);
            console.log("Test video deleted.");
        }
    }
}

runTest();
