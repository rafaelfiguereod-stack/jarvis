import { TerminalExecutor, type CommandResult } from './executor.ts';
import { readFileSync, existsSync } from 'node:fs';

export class WSLBridge {
  private executor: TerminalExecutor;
  private windowsHome: string | null = null;

  constructor() {
    this.executor = new TerminalExecutor();

    if (WSLBridge.isWSL()) {
      this.detectWindowsHome();
    }
  }

  static isWSL(): boolean {
    try {
      if (process.platform !== 'linux') {
        return false;
      }

      if (existsSync('/proc/version')) {
        const version = readFileSync('/proc/version', 'utf-8').toLowerCase();
        return version.includes('microsoft') || version.includes('wsl');
      }

      if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  async runWindowsCommand(command: string): Promise<CommandResult> {
    if (!WSLBridge.isWSL()) {
      throw new Error('Not running in WSL environment');
    }

    try {
      return await this.executor.execute(`cmd.exe /C "${command.replace(/"/g, '\\"')}"`);
    } catch (error) {
      throw new Error(`Failed to run Windows command: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async runPowerShell(script: string): Promise<CommandResult> {
    if (!WSLBridge.isWSL()) {
      throw new Error('Not running in WSL environment');
    }

    try {
      // Pass the script via -EncodedCommand (base64 of UTF-16LE) instead of
      // hand-escaping quotes/backticks/dollar-signs into a -Command string.
      // Encoding sidesteps every shell-quoting edge case (the prior manual
      // escaping was incomplete — e.g. it did not handle `;`, `&`, `|`, `(`)
      // and the resulting base64 is plain [A-Za-z0-9+/=], safe to embed in the
      // bash `-c` line with no further escaping. -NoProfile/-NonInteractive
      // keep the child shell from sourcing the user profile or blocking on a
      // prompt.
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      return await this.executor.execute(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`);
    } catch (error) {
      throw new Error(`Failed to run PowerShell script: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getWindowsHome(): string | null {
    return this.windowsHome;
  }

  private detectWindowsHome(): void {
    try {
      const result = this.executor.execute('cmd.exe /C "echo %USERPROFILE%"');
      result.then(res => {
        const path = res.stdout.trim();

        if (path && !path.includes('%')) {
          this.windowsHome = this.convertWindowsPath(path);
        }
      }).catch(() => {
        this.windowsHome = null;
      });
    } catch {
      this.windowsHome = null;
    }
  }

  private convertWindowsPath(windowsPath: string): string {
    const normalized = windowsPath.replace(/\\/g, '/');

    const driveMatch = normalized.match(/^([A-Z]):/i);
    if (driveMatch) {
      const drive = driveMatch[1]?.toLowerCase();
      const rest = normalized.slice(2);
      return `/mnt/${drive}${rest}`;
    }

    return normalized;
  }

  async convertToWindowsPath(wslPath: string): Promise<string> {
    if (!WSLBridge.isWSL()) {
      throw new Error('Not running in WSL environment');
    }

    try {
      const result = await this.executor.execute(`wslpath -w "${wslPath}"`);
      return result.stdout.trim();
    } catch (error) {
      throw new Error(`Failed to convert WSL path: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async convertToWSLPath(windowsPath: string): Promise<string> {
    if (!WSLBridge.isWSL()) {
      throw new Error('Not running in WSL environment');
    }

    try {
      const result = await this.executor.execute(`wslpath -u "${windowsPath}"`);
      return result.stdout.trim();
    } catch (error) {
      throw new Error(`Failed to convert Windows path: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
