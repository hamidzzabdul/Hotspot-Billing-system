Place public router CA certificates in this directory on the VPS. These files are
mounted read-only at `/app/certs` in the backend container and excluded from Git
and Docker image builds. Never place CA private keys or router backups here.

For the existing router CA, copy `wifex-ca.crt` here and set
`ROUTER_CA_FILE=/app/certs/wifex-ca.crt` in `deploy/.env`.

This trust applies to backend-to-router management only. Customer HotSpot HTTPS
login requires a certificate trusted by customer browsers for your login domain.
