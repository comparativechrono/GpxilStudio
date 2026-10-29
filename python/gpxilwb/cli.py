"""Run the studio's command-line programs by name.

    python -m gpxilwb gpxil info /data/examples/worked-example.gpxil.tif

is the same as typing ``gpxil info …`` on a computer where gpxiltools is
installed with pip. The studio's terminal uses this for its commands, and
notebooks use it for ``!gpxil …`` lines.
"""
from __future__ import annotations

import builtins
import importlib
import sys
from typing import Callable, Dict, List, Optional

# program name -> "module:function" (the console scripts of the packages)
PROGRAMS: Dict[str, str] = {
    "gpxil": "gpxiltools.cli:main",
    "gpxil2pxil": "gpxil2pxil.cli:main",
    "pxil": "pxil:main",
}

# what each program is for, in a few words (for help and man in the terminal)
ABOUT: Dict[str, str] = {
    "gpxil": "gpxil genome pixel images: encode, info, validate, stats, subset, compare, render, book, fasta, vcf, palettes; and to look for"
    " patterns: runs, stack, spectrum, annotate, skew, period",
    "gpxil2pxil": "pictures (pxil files) of genes, transcripts and proteins from a gpxil genome",
    "pxil": "pxil files (one sequence as a picture): print them as FASTA, or their metadata",
}

# Programs whose packages load only when first used (none: gpxiltools' NumPy, Pillow and jsonschema load with Python).
NEEDS: Dict[str, List[str]] = {}
MODULES: Dict[str, str] = {}

# the programs that ask questions with input() (none)
_ASKS: set = set()

_NO_TYPING = "\n{prog}: this terminal cannot answer questions.\n"


def entry_point(name: str) -> Callable[[Optional[List[str]]], int]:
    """The main() of a program, imported when it is first used."""
    if name not in PROGRAMS:
        raise KeyError(name)
    mod, func = PROGRAMS[name].split(":")
    return getattr(importlib.import_module(mod), func)


def _exit_status(code) -> int:
    if code is None:
        return 0
    if isinstance(code, bool):
        return int(code)
    if isinstance(code, int):
        return code
    print(code, file=sys.stderr)
    return 1


def run(argv: List[str]) -> int:
    """Run ``argv[0]`` (a program name) with the arguments ``argv[1:]`` and
    return its exit status, as a shell would. Nothing is raised: an error in
    the program is printed, as Python would print it, and gives status 1."""
    if not argv:
        print("usage: python -m gpxilwb PROGRAM [ARGUMENTS ...]\nprograms: " + ", ".join(PROGRAMS),
              file=sys.stderr)
        return 2
    name, args = argv[0], list(argv[1:])
    if name not in PROGRAMS:
        print("gpxilwb: no program called {!r} (there are: {})".format(name, ", ".join(PROGRAMS)), file=sys.stderr)
        return 127
    main = entry_point(name)
    old_input, old_argv = builtins.input, sys.argv[:]
    told = []

    def no_input(prompt=""):
        if prompt:
            sys.stdout.write(str(prompt))
        if not told:
            told.append(True)
            sys.stderr.write(_NO_TYPING.format(prog=name))
        raise EOFError

    if name in _ASKS:
        builtins.input = no_input
    sys.argv[:] = [name] + args
    try:
        return _exit_status(main(args))
    except SystemExit as e:
        return _exit_status(e.code)
    except KeyboardInterrupt:
        return 130
    except Exception:  # noqa: BLE001 - show it as Python would, and carry on
        import traceback
        traceback.print_exc()
        return 1
    finally:
        builtins.input = old_input
        sys.argv[:] = old_argv
        try:
            sys.stdout.flush()
        except Exception:  # noqa: BLE001
            pass


def main() -> None:
    sys.exit(run(sys.argv[1:]))


if __name__ == "__main__":
    main()
