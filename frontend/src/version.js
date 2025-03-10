/**
 * MyTube Frontend Version Information
 */

const VERSION = {
  number: "1.0.0",
  buildDate: new Date().toISOString().split("T")[0],
  name: "MyTube Frontend",
  displayVersion: function () {
    console.log(`
╔═══════════════════════════════════════════════╗
║                                               ║
║   ${this.name}                             ║
║   Version: ${this.number}                          ║
║   Build Date: ${this.buildDate}                    ║
║                                               ║
╚═══════════════════════════════════════════════╝
`);
  },
};

export default VERSION;
