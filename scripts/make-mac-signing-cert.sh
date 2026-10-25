#!/bin/sh
# Make the self-signed macOS code-signing certificate and store it as the release workflow's
# NOMAD_MAC_CERT / NOMAD_MAC_CERT_PASSWORD secrets. No Apple account is involved.
#
# Every build signed with this certificate has the same designated requirement, which is what
# Squirrel.Mac checks before it installs an update. Keep ~/.nomad-signing safe: a build signed with
# a new certificate can't update an app signed with the old one, so users would have to reinstall.
#
# Run it on your Mac, from the repo: sh scripts/make-mac-signing-cert.sh   (needs `gh auth login`)
set -eu

NAME="Nomad Self-Signed"
REPO="knownasilya/nomad"
DIR="$HOME/.nomad-signing"
OPENSSL=/usr/bin/openssl

mkdir -p "$DIR"
chmod 700 "$DIR"
cd "$DIR"

if [ -f nomad.p12 ]; then
  echo "Reusing the existing certificate in $DIR"
else
  LEGACY=""
  if "$OPENSSL" version | grep -q '^OpenSSL 3'; then LEGACY="-legacy"; fi

  cat > cert.cnf <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
  "$OPENSSL" rand -hex 24 > password
  chmod 600 password
  "$OPENSSL" req -x509 -newkey rsa:2048 -nodes -days 7300 -config cert.cnf -keyout key.pem -out cert.pem
  "$OPENSSL" pkcs12 -export $LEGACY -inkey key.pem -in cert.pem -name "$NAME" \
    -out nomad.p12 -passout "pass:$(cat password)"
  rm key.pem cert.cnf
  chmod 600 nomad.p12
  echo "Made $DIR/nomad.p12"
fi

base64 -i nomad.p12 | gh secret set NOMAD_MAC_CERT --repo "$REPO"
gh secret set NOMAD_MAC_CERT_PASSWORD --repo "$REPO" < password
echo "Set NOMAD_MAC_CERT and NOMAD_MAC_CERT_PASSWORD on $REPO"
