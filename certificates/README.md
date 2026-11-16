# Optional certificate authorities

Builds use the operating system trust store by default. If your network uses a corporate proxy, place its PEM-encoded root certificate here with a `.crt`, `.pem`, or `.cer` extension before building. Certificates are appended to the container trust store and are ignored by Git. Never place private keys here.
