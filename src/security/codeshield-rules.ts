/**
 * CodeShield default rule sets.
 *
 * This file holds the **policy content** — concrete regex lists for the 12
 * risk categories. It is deliberately separate from `code-shield.ts`
 * (the mechanism) so that:
 *
 *   1. The kernel module can stay policy-free; operators can replace these
 *      rules per context without forking the codebase.
 *   2. Domain-specific agents (DevOps, embedded, research) can inject their
 *      own allow-by-default rules via `CodeShieldConfig.rules`.
 *
 * Usage:
 *
 *     new CodeShield({
 *       enabled: true,
 *       rules: { ...DEFAULT_RULES, destructive: [], network: [] },
 *     });
 *
 * These defaults are a **seed**, not a spec. Treat them like `/etc/default/*`
 * files — tune for your threat model.
 */

export interface RulePattern {
  re: RegExp;
  desc: string;
}

export interface CodeShieldRuleSet {
  shellInjection: RegExp[];
  privilege: RulePattern[];
  network: RulePattern[];
  destructive: RulePattern[];
  package: RulePattern[];
  service: RulePattern[];
  userMgmt: RulePattern[];
  criticalPaths: RegExp[];
  interpreter: RulePattern[];
  envExposure: RulePattern[];
  pipeToInterpreter: RegExp[];
}

export const DEFAULT_RULES: CodeShieldRuleSet = {
  shellInjection: [
    /;\s*\S/,
    /&&/,
    /\|\|/,
    /`[^`]*`/,
    /\$\([^)]*\)/,
    /\$\{[^}]*\}/,
  ],

  privilege: [
    { re: /\bsudo\b/, desc: "sudo invocation" },
    { re: /\bsu\b(?!do)/, desc: "su invocation" },
    { re: /\bchmod\s+(0?7{3}|[0-7]*[4567]{3})\b/, desc: "chmod world-writable/executable" },
    { re: /\bchown\b/, desc: "chown" },
    { re: /\bsetcap\b/, desc: "setcap" },
  ],

  network: [
    { re: /\bcurl\b/, desc: "curl" },
    { re: /\bwget\b/, desc: "wget" },
    { re: /\bnc\b/, desc: "nc (netcat)" },
    { re: /\bncat\b/, desc: "ncat" },
    { re: /\/dev\/tcp\//, desc: "/dev/tcp bash network" },
    { re: /\bssh\b/, desc: "ssh" },
    { re: /\bscp\b/, desc: "scp" },
    { re: /\brsync\b.*::/, desc: "rsync remote" },
  ],

  destructive: [
    { re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\b/, desc: "rm -rf" },
    { re: /\bmkfs(\.[a-z0-9]+)?\b/, desc: "mkfs" },
    { re: /\bdd\s+if=/, desc: "dd if=" },
    { re: /\bshred\b/, desc: "shred" },
    { re: /\bwipefs\b/, desc: "wipefs" },
    { re: /\bfdisk\b/, desc: "fdisk" },
    { re: /:\(\)\s*\{.{0,80}\|\s*:\s*&\s*\}\s*;/, desc: "fork bomb" },
  ],

  package: [
    { re: /\bapt(?:-get)?\s+(install|remove|purge|autoremove)\b/, desc: "apt install/remove" },
    { re: /\byum\s+(install|remove|erase)\b/, desc: "yum install/remove" },
    { re: /\bdnf\s+(install|remove|erase)\b/, desc: "dnf install/remove" },
    { re: /\bpacman\s+-[SRU]/, desc: "pacman install/remove" },
    { re: /\bpip\s+(install|uninstall)\b/, desc: "pip install" },
    { re: /\bpip3\s+(install|uninstall)\b/, desc: "pip3 install" },
    { re: /\bnpm\s+(install|i|uninstall|remove)\b/, desc: "npm install" },
    { re: /\bgem\s+(install|uninstall)\b/, desc: "gem install" },
  ],

  service: [
    { re: /\bsystemctl\s+(start|stop|restart|enable|disable|mask)\b/, desc: "systemctl mutation" },
    { re: /\bservice\s+\S+\s+(start|stop|restart)\b/, desc: "service mutation" },
    { re: /\/etc\/init\.d\//, desc: "init.d script invocation" },
  ],

  userMgmt: [
    { re: /\buseradd\b/, desc: "useradd" },
    { re: /\busermod\b/, desc: "usermod" },
    { re: /\buserdel\b/, desc: "userdel" },
    { re: /\bpasswd\b/, desc: "passwd" },
    { re: /\bgroupadd\b/, desc: "groupadd" },
    { re: /\bgroupdel\b/, desc: "groupdel" },
  ],

  criticalPaths: [
    /\/etc\//,
    /\/boot\//,
    /\/sys\//,
    /\bsshd_config\b/,
    /\biptables\b/,
    /\bip6tables\b/,
    /\bufw\b/,
    /\bnftables\b/,
    /\/root\/\.ssh\//,
  ],

  interpreter: [
    { re: /\bpython[23]?\s+-c\b/, desc: "python -c" },
    { re: /\bnode\s+-e\b/, desc: "node -e" },
    { re: /\bperl\s+-e\b/, desc: "perl -e" },
    { re: /\bruby\s+-e\b/, desc: "ruby -e" },
    { re: /\bbash\s+-c\b/, desc: "bash -c" },
    { re: /\bsh\s+-c\b/, desc: "sh -c" },
    { re: /\beval\s/, desc: "eval" },
  ],

  envExposure: [
    { re: /^\s*env\s*($|\|)/, desc: "env dump" },
    { re: /\bprintenv\b/, desc: "printenv" },
    { re: /\bcat\s+\/proc\/self\/environ\b/, desc: "/proc/self/environ read" },
    { re: /\bcat\s+\/proc\/\d+\/environ\b/, desc: "/proc/<pid>/environ read" },
  ],

  // Pipe payload into an interpreter: cat foo | bash, base64 -d | python3, …
  pipeToInterpreter: [
    /\|\s*(?:bash|sh|zsh|ksh|dash|ash|fish)\b/,
    /\|\s*(?:python[23]?|node|perl|ruby|php)\b/,
  ],
};
