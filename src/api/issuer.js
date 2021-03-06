import {Router} from 'express';
import {handleErrorResponse} from '../lib/util';
import {templates, factom, veresOne} from '../lib/issuer';
import {assertValidIssuanceCredential, getRequestedIssuer} from'../lib/credential';
import factomDid from '../resources/did/factomDid.json';
import veresOneDid from '../resources/did/veresOneDid.json';


export default ({config}) => {
    let api = Router();

    // Internal Endpoints

    /*	Issue new credential
        Issues a credential and returns it in the response body.
        Support of this part of the API is REQUIRED for implementations.
    */
    api.post('/credentials', async (req, res) => {
        if (!req.body.credential) {
            res.status(400).send('No credential specified in request');
        }

        const credential = req.body.credential;
        const options = req.body.options;

        //check credential
        try {
            assertValidIssuanceCredential(credential);
        } catch (err) {
            handleErrorResponse(res, err);
            return;
        }

        //extract issuer from options
        let requestedIssuer;
        if (!options) {
            // if no options provided, use the account did
            requestedIssuer = req.user.did;
        } else {
            // else use the requested did
            requestedIssuer = await getRequestedIssuer(options)
                .catch(err => {
                    handleErrorResponse(res, err);
                    return false;
                });
        }

        if (!requestedIssuer) {
            return;
        }

        switch (requestedIssuer) {
            case factomDid.identity.did:
                return factom.issueFactomCredential(credential)
                    .then(result => res.status(201).send(result))
                    .catch(err => handleErrorResponse(res, err));
            case veresOneDid.did:
                return veresOne.issueVeresCredential(credential)
                    .then(result => res.status(201).send(result))
                    .catch(err => handleErrorResponse(res, err, req));
            default:
                const {did, idSec} = req.user;
                if (!did || !idSec) {
                    return res.status(400).send('No DID found for user');
                }
                return factom.issueFactomCredential(credential, {did, idSec})
                    .then(result => res.status(201).send(result))
                    .catch(err => handleErrorResponse(res, err));
        }
    });

    /*	Compose and issue new credential
        Composes and issues a credential and returns it in the response body.
        Support of this part of the API is OPTIONAL for implementations.
    */
    api.post('/composeAndIssueCredential', (req, res) => {
        // not yet implemented

        res.status(501).send({message: 'Not yet implemented.'});
    });

    api.post('/templates', async (req, res) => {
        const issuerConfig = req.body;
        const user = req.user;
        try {
            templates.validateIssuerConfig(issuerConfig);
        } catch (err) {
            handleErrorResponse(res, err);
            return;
        }
        if (user.issuerConfigs.find(config => config.id === issuerConfig.id)) {
            const message = `Issuer config template with id: ${issuerConfig.id} already exists for authenticated user`;
            res.status(403).send({message});
        }
        user.issuerConfigs.push(issuerConfig);
        try {
            await user.save()
        } catch (err) {
            const message = `Could not save issuer template config to authenticated user. 
                    Originating message: ${err.message}`;
            return res.status(500).send({message});
        }
        res.status(200).send(issuerConfig);
    });

    api.get('/templates/:id', (req, res) => {
        const user = req.user;
        const {id: configId} = req.params;
        const issuerConfig = user.issuerConfigs.find(config => config.id === configId);
        if (!issuerConfig) {
            const message = `Could not find issuer config template with id: ${configId} for authenticated user.`;
            return res.status(404).send({message});
        }
        return res.status(200).send(issuerConfig);
    });

    api.post('/templates/:id/credentials', (req, res) => {
        const user = req.user;
        const {id: configId} = req.params;
        const {credentialSubject, revocationListIndex} = req.body;
        const issuerConfig = user.issuerConfigs.find(config => config.id === configId);
        if (!issuerConfig) {
            const message = `Could not find issuer config template with id: ${configId} for authenticated user.`;
            return res.status(404).send({message});
        }
        const {did, idSec} = user;
        const credential = templates.constructCredentialWithConfig({
            credentialSubject,
            revocationListIndex: revocationListIndex && revocationListIndex.toString(),
            did,
            config: issuerConfig
        });
        return factom.issueFactomCredential(credential, {did, idSec})
            .then(result => res.status(201).send(result))
            .catch(err => handleErrorResponse(res, err));
    });

    return api;
};
