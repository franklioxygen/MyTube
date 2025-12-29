/**
 * MyTube Backend Version Information
 */

export const VERSION = {
  number: "1.7.15",
  buildDate: new Date().toISOString().split("T")[0],
  name: "MyTube Backend Server",
  displayVersion: function () {
    console.log(`
╔═══════════════════════════════════════════════╗
║                                               ║
║   ${this.name}                       ║
║   Version: ${this.number}                          ║
║   Build Date: ${this.buildDate}                    ║
║                                               ║
╚═══════════════════════════════════════════════╝
`);
  },
};
