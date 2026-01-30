import { SessionManager } from "./session_manager.js";
import { strerror, VERSION } from "./utils.js";
import { Command } from "commander";
import express from "express";

const program = new Command().option("-p, --port <PORT>").parse();

const options = program.opts();

const PORT_NUMBER = options.port || 4416;

const httpServer = express();
httpServer.use(express.json());
httpServer.use(express.urlencoded({ extended: true }));

httpServer
    .listen(
        {
            host: "::",
            port: PORT_NUMBER,
        },
        (err) => {
            if (err) {
                console.error(
                    `Could not listen on [::]:${PORT_NUMBER}, falling back to 0.0.0.0 (Caused by ${strerror(err)})`,
                );
            } else {
                console.log(
                    `Started POT server (v${VERSION}) on on address [::]:${PORT_NUMBER}`,
                );
            }
        },
    )
    .on("error", () => {
        // ipv4 only systems might not be able to bind to "::", so we try 0.0.0.0 instead
        // this is temporary as we plan to bind to localhost in the next major version
        httpServer.listen(
            {
                host: "0.0.0.0",
                port: PORT_NUMBER,
            },
            (err) => {
                if (err) {
                    console.error(
                        `Could not listen on [::]:${PORT_NUMBER} (Caused by ${strerror(err)})`,
                    );
                } else {
                    console.log(
                        `Started POT server (v${VERSION}) on address 0.0.0.0:${PORT_NUMBER}`,
                    );
                }
            },
        );
    });

const sessionManager = new SessionManager();
httpServer.post("/get_pot", async (request, response) => {
    const body = request.body || {};
    if (body.data_sync_id)
        return response.status(400).send({
            error: "data_sync_id is deprecated, use content_binding instead",
        });
    if (body.visitor_data)
        return response.status(400).send({
            error: "visitor_data is deprecated, use content_binding instead",
        });
    const contentBinding: string | undefined = body.content_binding;
    const proxy: string = body.proxy;
    const bypassCache: boolean = body.bypass_cache || false;
    const sourceAddress: string | undefined = body.source_address;
    const disableTlsVerification: boolean =
        body.disable_tls_verification || false;

    try {
        const sessionData = await sessionManager.generatePoToken(
            contentBinding,
            proxy,
            bypassCache,
            sourceAddress,
            disableTlsVerification,
            body.challenge,
            body.disable_innertube || false,
            body.innertube_context,
        );

        response.send(sessionData);
    } catch (e) {
        const msg = strerror(e, /*update=*/ true);
        console.error(e.stack);
        response.status(500).send({ error: msg });
    }
});

httpServer.post("/invalidate_caches", async (request, response) => {
    sessionManager.invalidateCaches();
    response.status(204).send();
});

httpServer.post("/invalidate_it", async (request, response) => {
    sessionManager.invalidateIT();
    response.status(204).send();
});

httpServer.get("/ping", async (request, response) => {
    response.send({
        server_uptime: process.uptime(),
        version: VERSION,
    });
});

httpServer.get("/minter_cache", async (request, response) => {
    console.debug(sessionManager.minterCache);
    response.send(Array.from(sessionManager.minterCache.keys()));
});
