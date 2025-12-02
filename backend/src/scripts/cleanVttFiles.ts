import fs from "fs-extra";
import path from "path";
import { SUBTITLES_DIR } from "../config/paths";

/**
 * Clean existing VTT files by removing alignment tags that force left-alignment
 */
async function cleanVttFiles() {
    console.log("Starting VTT file cleanup...");
    
    try {
        if (!fs.existsSync(SUBTITLES_DIR)) {
            console.log("Subtitles directory doesn't exist");
            return;
        }
        
        const vttFiles = fs.readdirSync(SUBTITLES_DIR).filter((file) => file.endsWith(".vtt"));
        console.log(`Found ${vttFiles.length} VTT files to clean`);
        
        let cleanedCount = 0;
        
        for (const vttFile of vttFiles) {
            const filePath = path.join(SUBTITLES_DIR, vttFile);
            
            // Read VTT file
            let vttContent = fs.readFileSync(filePath, 'utf-8');
            
            // Check if it has alignment tags
            if (vttContent.includes('align:start') || vttContent.includes('position:0%')) {
                // Replace align:start with align:middle for centered subtitles (Safari needs this)
                // Remove position:0% which forces left positioning
                vttContent = vttContent.replace(/ align:start/g, ' align:middle');
                vttContent = vttContent.replace(/ position:0%/g, '');
                
                // Write cleaned content back
                fs.writeFileSync(filePath, vttContent, 'utf-8');
                console.log(`Cleaned: ${vttFile}`);
                cleanedCount++;
            }
        }
        
        console.log(`VTT cleanup complete. Cleaned ${cleanedCount} files.`);
    } catch (error) {
        console.error("Error during VTT cleanup:", error);
    }
}

// Run the script
cleanVttFiles().then(() => {
    console.log("Done");
    process.exit(0);
}).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
