# GitHub Lockdown Checklist

These steps require the founder's GitHub identity and organization permissions, so they should be run by the repository owner.

## 1. Create Or Choose A Private Organization

Recommended organization name:

```text
sovereign-labs
```

Move the repository in GitHub:

```text
Settings -> General -> Danger Zone -> Transfer ownership
```

After transfer, keep the repository private.

## 2. Require Signed Commits

Generate a GPG key on the founder machine:

```bash
gpg --full-generate-key
gpg --list-secret-keys --keyid-format=long
gpg --armor --export YOUR_KEY_ID
```

Add the exported public key in GitHub:

```text
GitHub -> Settings -> SSH and GPG keys -> New GPG key
```

Configure this repo:

```bash
git config user.signingkey YOUR_KEY_ID
git config commit.gpgsign true
git config tag.gpgsign true
```

## 3. Branch Protection

Enable on `main`:

- Require a pull request before merging.
- Require approvals from CODEOWNERS.
- Require signed commits.
- Require status checks to pass.
- Block force pushes.
- Block deletions.

## 4. Secret Scanning

Enable:

- GitHub Secret Protection.
- Push protection.
- Dependabot alerts.
- Dependabot security updates.

## 5. Production Secrets

Store runtime secrets outside Git:

- AWS Secrets Manager.
- AWS SSM Parameter Store.
- Docker host environment variables.
- CI/CD encrypted secrets.
