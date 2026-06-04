# Reference Agents

This directory contains external agent projects as Git submodules. Treat them as
study material and upstream references while building Param Agent in the main
repo.

## Included Projects

- `hermes-agent`: https://github.com/NousResearch/hermes-agent
- `openclaw`: https://github.com/openclaw/openclaw

## Working With Submodules

Clone this repo with references included:

```sh
git clone --recurse-submodules <repo-url>
```

Initialize references after a normal clone:

```sh
git submodule update --init --recursive
```

Update a reference to its latest upstream commit:

```sh
git submodule update --remote references/hermes-agent
git submodule update --remote references/openclaw
```

After updating a submodule, commit the changed submodule pointer in this repo.
