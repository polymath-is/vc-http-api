import {Router} from "express";
import {
    checkRevocationStatus,
    createRevocationCredential,
    getRevocationCredential,
    publishRevocationCredential,
    updateRevocationCredential, validateRevocationConfig
} from "../lib/revocation";
import {issueFactomCredential} from "../lib/factomService";
import {handleErrorResponse} from "../lib/util";

export default ({config}) => {
    let api = Router();

    api.post('/config', async (req, res) => {
            const revocationConfig = req.body;
            const user = req.user;
            try {
                await validateRevocationConfig(revocationConfig);
            } catch (err) {
                return handleErrorResponse(res, err);
            }
            user.revocationConfig = revocationConfig;
            return user.save()
                .then(() => res.status(200).send())
                .catch(err => {
                    const message = `Could not save revocation config to authenticated user. 
                    Originating message: ${err.message}`;
                    res.status(500).send({message});
                });
        }
    );

    api.get('/config', (req, res) => {
        const user = req.user;
        if (!user.revocationConfig) {
            return res.status(404).send({message: "No revocation config found for authenticated user."});
        }
        return res.status(200).send(user.revocationConfig);
    });

    api.post('/init', async (req, res) => {
        const {user} = req;
        const {revocationConfig, did, idSec} = user;
        const {listSize} = req.body;
        if (!listSize || typeof listSize !== "number") {
            const message = `Unexpected listSize value. ${listSize} is not of type number.`;
            return res.status(400).send({message});
        }
        if (!revocationConfig) {
            const message = "No revocation config found for authenticated user";
            return res.status(404).send({message});
        }
        if (revocationConfig.url) {
            const message = "Revocation list already initialized, cannot reinitialize without overwriting statuses.";
            return res.status(403).send({message});
        }
        const rc = await createRevocationCredential(listSize, did);
        const rvc = await issueFactomCredential(rc, {did, idSec});
        return publishRevocationCredential(rvc, revocationConfig)
            .then(url => {
                user.revocationConfig.url = url;
                return user.save()
                    .then(() => res.status(200).send({url}));
            })
            .catch(err => handleErrorResponse(res, err));

    });

    api.post('/update', (req, res) => {
        const {user, body} = req;
        const {revocationIndex, revoked} = body;
        const {revocationConfig, did, idSec} = user;
        if (!revocationConfig) {
            const message = "Revocation not configured for authenticated user."
            res.status(400).send({message});
        }
        if (!revocationConfig.url) {
            const message = "Revocation credential not initialized.";
            res.status(400).send({message})
        }
        return getRevocationCredential(revocationConfig)
            .then(rvc => updateRevocationCredential(rvc, revocationIndex, revoked))
            .then(updatedRc => issueFactomCredential(updatedRc, {did, idSec}))
            .then(updatedRvc => publishRevocationCredential(updatedRvc, revocationConfig))
            .then(() => res.status(200).send())
            .catch(err => handleErrorResponse(res, err));
    });

    api.get('/status/:index', (req, res) => {
        const {index} = req.params;
        const {user} = req;
        const {revocationConfig} = user;
        if (!revocationConfig) {
            const message = "Revocation not configured for authenticated user."
            res.status(400).send({message});
        }
        if (!revocationConfig.url) {
            const message = "Revocation credential not initialized.";
            res.status(400).send({message})
        }
        let revocationIndex;
        try {
            revocationIndex = parseInt(index);
        } catch(err) {
            const message = `Unable to parse ${index} to a non-zero integer.`
            return res.status(400).send({message});
        }
        return getRevocationCredential(revocationConfig)
            .then(rvc => checkRevocationStatus(rvc, revocationIndex))
            .then(result => res.status(200).send({revoked: result}))
            .catch(err => handleErrorResponse(res, err));
    });
    return api;
};
