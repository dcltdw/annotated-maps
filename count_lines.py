#!/usr/local/bin/python3
from pathlib import Path

DESIRED_SUFFIXES = [
    '.yml',
    '.md',
    '.py',
    '.txt',
    '.json',
    # backend
    '.cpp',
    '.h',
    # frontend
    '.ts',
    '.html',
    '.tsx',
    '.css',
    # database
    '.sql',
]

IGNORE_DIRECTORIES = [
    '.',
    '..',
    '.git',
    '.gitignore',
    'node_modules',
    'build',
    'dist',
    '.vite',
    '__pycache__',
]

IGNORE_FILES = [
    'package-lock.json',
    'package.json',
]


def examine_directory(path):
    count = 0
    for filename in path.iterdir():
        if filename.is_dir():
            if filename.name not in IGNORE_DIRECTORIES:
                count += examine_directory(filename)
        elif filename.suffix in DESIRED_SUFFIXES:
            data = filename.read_text()
            count += len(data.split('\n'))
            if (count == 0):
                raise RuntimeException(f'{data=}')
    return count            


def main():
    root = Path('.')
    total_count = examine_directory(root)
    print(f"Number of lines: {total_count}")


if __name__ == '__main__':
    main()
