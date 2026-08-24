import ast
with open('main.py', 'r', encoding='utf-8') as f:
    tree = ast.parse(f.read())

for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef) and node.name == 'ask':
        print('Fonction ask trouvee')
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call) and hasattr(dec.func, 'attr'):
                arg_val = dec.args[0].value if dec.args else '?'
                print('Decorateur: @app.' + dec.func.attr + '("' + arg_val + '")')
        for arg in node.args.args:
            print('Argument: ' + arg.arg)
        break
else:
    print('Fonction ask NON trouvee')
