"use strict";

const { AppService } = require("./service");

const service = new AppService();

function getVersion(req, res, next) {
  service
    .getVersion(req)
    .then((data) => res.json({ success: true, data }))
    .catch(next);
}

function downloadApk(req, res, next) {
  const abi = req.query ? req.query.abi : undefined;
  const token = req.query ? req.query.t : undefined;

  Promise.resolve()
    .then(async () => {
      if (!token) {
        const err = new Error("Missing download token");
        err.statusCode = 403;
        throw err;
      }
      return service.resolveApk({ abi, token });
    })
    .then((apk) => {
      res.setHeader("Cache-Control", "private, no-store");
      // res.download honours Range, so an interrupted download resumes.
      res.download(apk.filePath, apk.fileName, {
        etag: !apk.sha256,
        headers: apk.sha256 ? { ETag: `"${apk.sha256}"` } : undefined,
      });
    })
    .catch(next);
}

module.exports = {
  getVersion,
  downloadApk,
};